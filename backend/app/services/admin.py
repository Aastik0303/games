"""Operator views: overview metrics, room controls, audit log, community pulse.

Every number is an aggregate. Nothing here exposes profiles, chat content or
per-user activity histories.
"""

from __future__ import annotations

import statistics
import time
from datetime import datetime
from typing import Any

from sqlalchemy import func, select

from app.db.models import AuditEvent, Report
from app.errors import AppError
from app.games.registry import GAMES
from app.infra import Infra
from app.redis import keys
from app.schemas.common import iso
from app.services import audit
from app.services.sessions import Principal

ONLINE_WINDOW_MS = 5 * 60 * 1000
PULSE_FLOOR = 10  # below this, show null rather than tiny exact counts


def _hour(ms: int) -> str:
    return time.strftime("%Y%m%d%H", time.gmtime(ms / 1000))


def _coarse(n: int) -> int | None:
    if n < PULSE_FLOOR:
        return None
    return n - n % 10


class AdminService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra

    async def _online_count(self) -> int:
        now = int(time.time() * 1000)
        await self.infra.redis.zremrangebyscore(keys.online_users(), "-inf", now - 24 * 3600 * 1000)
        return int(await self.infra.redis.zcount(keys.online_users(), now - ONLINE_WINDOW_MS, "+inf"))

    async def _rooms(self, limit: int = 200) -> list[dict[str, Any]]:
        ids: list[str] = await self.infra.redis.zrevrange(keys.rooms_active(), 0, limit - 1)
        docs = []
        for rid in ids:
            doc = await self.infra.services.rooms.load(rid)
            if doc and doc["room"]["phase"] != "closed":
                docs.append(doc)
        return docs

    async def _matches(self, hour: str, game_id: str | None = None) -> int:
        name = f"matches:{game_id}" if game_id else "matches"
        raw = await self.infra.redis.get(keys.metric_hourly(name, hour))
        return int(raw) if raw else 0

    async def _matches_last_hour(self, game_id: str | None = None) -> int:
        now = int(time.time() * 1000)
        cur, prev = _hour(now), _hour(now - 3_600_000)
        frac = (now / 1000 % 3600) / 3600
        return round(await self._matches(cur, game_id) + (1 - frac) * await self._matches(prev, game_id))

    async def overview(self) -> dict[str, Any]:
        now = int(time.time() * 1000)
        docs = await self._rooms()
        rooms: list[dict[str, Any]] = []
        reconnects = participants = 0
        for d in docs:
            r, meta = d["room"], d["meta"]
            recent = [t for t in meta.get("reconnects", []) if t > now - 3_600_000]
            reconnects += len(recent)
            participants += len(r["participants"])
            host = next((p for p in r["participants"] if p["user"]["id"] == r["hostId"]), None)
            issues = []
            if host is None or host["connection"] != "online":
                issues.append("stale_host")
            if len(recent) >= 5:
                issues.append("high_reconnects")
            if len(r["participants"]) >= r["capacity"]:
                issues.append("near_capacity")
            created = datetime.fromisoformat(r["createdAt"]).timestamp()
            rooms.append(
                {
                    "roomId": r["id"],
                    "code": r["code"],
                    "activity": r["activity"]["kind"],
                    "participants": len(r["participants"]),
                    "capacity": r["capacity"],
                    "phase": r["phase"],
                    "ageSeconds": max(0, int(now / 1000 - created)),
                    "reconnectsLastHour": len(recent),
                    "issues": issues,
                }
            )
        segments: set[str] = await self.infra.redis.smembers(keys.mm_segments())  # type: ignore[misc]
        waiting_by_game: dict[str, int] = {}
        for seg in segments:
            n = int(await self.infra.redis.zcard(keys.mm_queue(seg)))
            gid = seg.split(":")[0]
            waiting_by_game[gid] = waiting_by_game.get(gid, 0) + n
        queues = []
        for gid, game in GAMES.items():
            if "multiplayer" not in game.modes:
                continue
            samples = [float(x) for x in await self.infra.redis.lrange(keys.metric_samples("wait", gid), 0, -1)]  # type: ignore[misc]
            queues.append(
                {
                    "gameId": gid,
                    "title": game.title,
                    "waiting": waiting_by_game.get(gid, 0),
                    "medianWaitSeconds": round(statistics.median(samples), 1) if samples else None,
                    "matchesLastHour": await self._matches_last_hour(gid),
                }
            )
        async with self.infra.db() as db:
            open_reports = int(
                (await db.execute(select(func.count()).select_from(Report).where(Report.status == "open"))).scalar_one()
            )
        hourly = []
        for i in range(11, -1, -1):
            ms = now - i * 3_600_000
            hourly.append({"hour": time.strftime("%H:00", time.gmtime(ms / 1000)), "matches": await self._matches(_hour(ms))})
        return {
            "generatedAt": iso(),
            "metrics": {
                "activeUsers": await self._online_count(),
                "activeRooms": len(docs),
                "playersInQueue": sum(waiting_by_game.values()),
                "matchesLastHour": await self._matches_last_hour(),
                "openReports": open_reports,
                "reconnectRate": round(reconnects / participants, 3) if participants else 0,
            },
            "hourlyMatches": hourly,
            "rooms": sorted(rooms, key=lambda x: (-len(x["issues"]), -x["participants"]))[:100],
            "queues": queues,
        }

    async def pulse(self) -> dict[str, Any]:
        docs = await self._rooms()
        online = await self._online_count()
        live_by_game: dict[str, int] = {}
        for d in docs:
            gid = d["room"]["activity"].get("gameId")
            if gid:
                live_by_game[gid] = live_by_game.get(gid, 0) + 1
        enabled = {g["id"]: g for g in await self.infra.services.catalog.list_enabled()}
        trending = sorted(
            (
                {"gameId": gid, "title": enabled[gid]["title"], "liveRooms": n}
                for gid, n in live_by_game.items()
                if gid in enabled
            ),
            key=lambda t: -t["liveRooms"],
        )[:3]
        activity = "busy" if online >= 500 else "steady" if online >= 50 else "quiet"
        return {
            "activity": activity,
            "playersOnline": _coarse(online),
            "activeRooms": _coarse(len(docs)),
            "trending": trending,
            "generatedAt": iso(),
        }

    async def close_room(self, actor: Principal, room_id: str, reason: str) -> None:
        doc = await self.infra.services.rooms.load(room_id)
        if doc is None or doc["room"]["phase"] == "closed":
            raise AppError("not_found", "Room not found")
        async with self.infra.db() as db:
            audit.record(
                db,
                actor_id=actor.id,
                action="room.close",
                target_type="room",
                target_id=room_id,
                reason=reason,
                data={"code": doc["room"]["code"]},
            )
            await db.commit()
        await self.infra.services.rooms.close(room_id, "moderation")

    async def remove_participant(self, actor: Principal, room_id: str, user_id: str, reason: str) -> None:
        async with self.infra.db() as db:
            audit.record(
                db,
                actor_id=actor.id,
                action="room.remove_participant",
                target_type="room",
                target_id=room_id,
                reason=reason,
                data={"userId": user_id},
            )
            await db.commit()
        await self.infra.services.rooms.remove_member(room_id, user_id, "kicked", ban=True)
        await self.infra.services.rooms.system_message(room_id, "A moderator removed a participant.")

    async def audit_log(self, limit: int) -> list[dict[str, Any]]:
        async with self.infra.db() as db:
            rows = (await db.execute(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit))).scalars().all()
        return [
            {
                "id": a.id,
                "actorId": a.actor_id,
                "action": a.action,
                "targetType": a.target_type,
                "targetId": a.target_id,
                "reason": a.reason,
                "createdAt": iso(a.created_at),
            }
            for a in rows
        ]
