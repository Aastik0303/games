"""Matchmaking: segmented queues, atomic group claims, idempotent room creation.

Segments: game x language x group size x age group (minors only ever match
minors — a safety rule, not a ranking signal). Difficulty is a soft
preference that relaxes after ``match_widen_after_sec``. Ranking is queue time
first; shared interests (only for people who opted in) break ties between
tickets that have waited about as long. Protected traits are never used.

Correctness (see docs/MATCHMAKING.md):
1. A worker picks a candidate group, then CLAIM_TICKETS removes all of them
   from the queue in one Lua call — or none, if any was taken meanwhile.
2. The claim is recorded under a fresh op id before the room is created.
3. Room id is derived from the op id and reserved with SET NX, so retries and
   recovery never create a second room for the same match.
4. Tickets become ``matched`` (and players are told) only after the room
   exists. If the worker dies first, recovery either finishes the match (room
   exists) or returns the tickets to the queue at their original position.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import time
from typing import Any

from redis.exceptions import RedisError

from app.errors import AppError
from app.games.registry import live_game
from app.infra import Infra, new_id
from app.observability import metrics, report_exception
from app.redis import keys
from app.schemas.common import iso_ms
from app.schemas.rooms import MatchCriteria
from app.services.rooms import age_group, member_info_from_user
from app.services.sessions import Principal

log = logging.getLogger("prism.matchmaking")
ACTIVE = ("queued", "searching", "widening")
INTEREST_TIE_WINDOW_MS = 10_000


def now_ms() -> int:
    return int(time.time() * 1000)


def hour_label(ms: int | None = None) -> str:
    return time.strftime("%Y%m%d%H", time.gmtime((ms or now_ms()) / 1000))


class MatchmakingService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra

    @property
    def s(self) -> Any:
        return self.infra.settings

    # --- player API ------------------------------------------------------------
    async def enqueue(self, principal: Principal, criteria: MatchCriteria) -> dict[str, Any]:
        await self.infra.services.flags.require("multiplayer", "Matchmaking is currently disabled.")
        summary, game = await self.infra.services.catalog.get_enabled(criteria.game_id)
        if live_game(game.id) is None or "multiplayer" not in game.modes:
            raise AppError("validation", "Choose a multiplayer activity.", fields={"gameId": "Not multiplayer"})
        lo, hi = max(2, game.min_players), min(4, game.max_players)
        if not lo <= criteria.group_size <= hi:
            raise AppError("validation", f"Group size must be between {lo} and {hi}.", fields={"groupSize": f"{lo}–{hi}"})
        if criteria.difficulty not in summary["difficulties"]:
            raise AppError("validation", "Difficulty not available.", fields={"difficulty": "Unavailable"})
        await self.infra.services.ratelimit.hit("matchmaking", principal.id)
        await self.cancel_for_user(principal.id)

        user = principal.user
        segment = f"{game.id}:{criteria.language}:{criteria.group_size}:{age_group(user.is_minor)}"
        tid = new_id("tkt")
        now = now_ms()
        crit = criteria.model_dump(by_alias=True)
        interests = list(criteria.interests) if user.consent_interests else []
        crit["interests"] = interests
        prefer_shared = bool((user.matching or {}).get("preferSharedInterests")) and user.consent_interests
        ttl = self.s.match_ticket_ttl_sec + 600
        pipe = self.infra.redis.pipeline(transaction=False)
        pipe.hset(
            keys.mm_ticket(segment, tid),
            mapping={
                "user": user.id,
                "criteria": json.dumps(crit),
                "enq": now,
                "status": "queued",
                "phase": "queued",
                "difficulty": criteria.difficulty,
                "interests": json.dumps(interests if prefer_shared else []),
                "widened": 0,
                "created_at": iso_ms(now),
            },
        )
        pipe.expire(keys.mm_ticket(segment, tid), ttl)
        pipe.zadd(keys.mm_queue(segment), {tid: now})
        pipe.expire(keys.mm_queue(segment), ttl)
        pipe.set(keys.mm_ticket_index(tid), segment, ex=ttl)
        pipe.set(keys.mm_user_ticket(user.id), tid, ex=ttl)
        pipe.sadd(keys.mm_segments(), segment)
        await pipe.execute()
        metrics.inc("mm_enqueued_total", game=game.id)
        await self._notify(user.id, tid, "queued")
        return {"ticketId": tid, "criteria": crit, "createdAt": iso_ms(now)}

    async def _ticket(self, ticket_id: str) -> tuple[str, dict[str, str]] | None:
        segment = await self.infra.redis.get(keys.mm_ticket_index(ticket_id))
        if not segment:
            return None
        data: dict[str, str] = await self.infra.redis.hgetall(keys.mm_ticket(segment, ticket_id))  # type: ignore[misc]
        return (segment, data) if data else None

    async def cancel(self, principal: Principal, ticket_id: str) -> None:
        found = await self._ticket(ticket_id)
        if found is None or found[1].get("user") != principal.id:
            return  # unknown or someone else's: nothing to cancel (idempotent, no oracle)
        segment, _ = found
        res = await self.infra.scripts.cancel_ticket(
            keys=[keys.mm_queue(segment), keys.mm_ticket(segment, ticket_id)], args=[ticket_id, "cancelled"]
        )
        if res == "ok":
            metrics.inc("mm_cancelled_total")
            await self._notify(principal.id, ticket_id, "cancelled")
        if await self.infra.redis.get(keys.mm_user_ticket(principal.id)) == ticket_id:
            await self.infra.redis.delete(keys.mm_user_ticket(principal.id))

    async def cancel_for_user(self, user_id: str) -> None:
        tid = await self.infra.redis.get(keys.mm_user_ticket(user_id))
        if not tid:
            return
        found = await self._ticket(tid)
        if found:
            segment, _ = found
            res = await self.infra.scripts.cancel_ticket(
                keys=[keys.mm_queue(segment), keys.mm_ticket(segment, tid)], args=[tid, "cancelled"]
            )
            if res == "ok":
                await self._notify(user_id, tid, "cancelled")
        await self.infra.redis.delete(keys.mm_user_ticket(user_id))

    async def status(self, principal: Principal, ticket_id: str) -> dict[str, Any]:
        found = await self._ticket(ticket_id)
        if found is None or found[1].get("user") != principal.id:
            raise AppError("not_found", "Ticket not found")
        t = found[1]
        if t["status"] == "matched":
            return {"ticketId": ticket_id, "phase": "matched", "roomCode": t.get("room_code")}
        if t["status"] in ("cancelled", "expired"):
            return {"ticketId": ticket_id, "phase": t["status"]}
        return {"ticketId": ticket_id, "phase": t.get("phase", "queued") if t["status"] == "queued" else "searching"}

    async def _notify(self, user_id: str, ticket_id: str, phase: str, room_code: str | None = None) -> None:
        if phase == "matched":
            await self.infra.services.events.publish_user(
                user_id, "matchmaking.matched", {"ticketId": ticket_id, "roomCode": room_code}
            )
        else:
            await self.infra.services.events.publish_user(user_id, "matchmaking.status", {"ticketId": ticket_id, "phase": phase})

    # --- matcher ---------------------------------------------------------------------
    async def match_once(self) -> int:
        """One pass over every segment. Safe to run on many workers at once. Returns matches made."""
        made = 0
        segments: set[str] = await self.infra.redis.smembers(keys.mm_segments())  # type: ignore[misc]
        for segment in sorted(segments):
            made += await self._match_segment(segment)
        return made

    async def _match_segment(self, segment: str) -> int:
        r = self.infra.redis
        queue: list[tuple[str, float]] = await r.zrange(keys.mm_queue(segment), 0, 199, withscores=True)
        metrics.set("mm_queue_depth", len(queue), segment=segment)
        if not queue:
            return 0
        pipe = r.pipeline(transaction=False)
        for tid, _ in queue:
            pipe.hgetall(keys.mm_ticket(segment, tid))
        rows: list[dict[str, str]] = await pipe.execute()
        now = now_ms()
        active: list[dict[str, Any]] = []
        for (tid, _), t in zip(queue, rows, strict=True):
            if not t or t.get("status") != "queued":
                await r.zrem(keys.mm_queue(segment), tid)
                continue
            age = now - int(t["enq"])
            if age > self.s.match_ticket_ttl_sec * 1000:
                res = await self.infra.scripts.cancel_ticket(
                    keys=[keys.mm_queue(segment), keys.mm_ticket(segment, tid)], args=[tid, "expired"]
                )
                if res == "ok":
                    metrics.inc("mm_expired_total")
                    await self._notify(t["user"], tid, "expired")
                continue
            if t.get("phase") == "queued":
                await r.hset(keys.mm_ticket(segment, tid), "phase", "searching")  # type: ignore[misc]
                await self._notify(t["user"], tid, "searching")
            if age > self.s.match_widen_after_sec * 1000 and t.get("widened") == "0":
                await r.hset(keys.mm_ticket(segment, tid), mapping={"widened": 1, "phase": "widening"})  # type: ignore[misc]
                t["widened"] = "1"
                await self._notify(t["user"], tid, "widening")
            active.append({**t, "id": tid})
        size = int(segment.split(":")[2])
        if len(active) < size:
            return 0
        blocked = await self.infra.services.moderation.block_pairs([t["user"] for t in active])
        made = 0
        for group in form_groups(active, size, blocked):
            if await self._claim_and_create(segment, group):
                made += 1
        return made

    async def _claim_and_create(self, segment: str, group: list[dict[str, Any]]) -> bool:
        op = new_id("mop")
        tids = [t["id"] for t in group]
        ticket_keys = [keys.mm_ticket(segment, tid) for tid in tids]
        ok = await self.infra.scripts.claim_tickets(keys=[keys.mm_queue(segment), *ticket_keys], args=[op, now_ms(), *tids])
        if not int(ok):
            metrics.inc("mm_claim_conflicts_total")
            return False
        await self.infra.redis.hset(keys.mm_claims(segment), op, json.dumps({"tickets": tids, "at": now_ms()}))  # type: ignore[misc]
        try:
            await self._create_room(segment, op, group)
            return True
        except Exception as e:
            await self._release(segment, op, tids)
            if not isinstance(e, RedisError | AppError):
                report_exception(e, op=op)
            return False

    async def _create_room(self, segment: str, op: str, group: list[dict[str, Any]]) -> None:
        r = self.infra.redis
        room_id = "room_" + hashlib.sha256(op.encode()).hexdigest()[:16]
        if not await r.set(keys.mm_op(op), room_id, nx=True, ex=3600):
            room_id = await r.get(keys.mm_op(op)) or room_id
        users = await self.infra.services.sessions.get_users([t["user"] for t in group])
        missing = [t for t in group if t["user"] not in users]
        if missing:
            # A player deleted their profile mid-match: drop their ticket, return the rest.
            for t in missing:
                await r.hset(keys.mm_ticket(segment, t["id"]), "status", "cancelled")  # type: ignore[misc]
            raise AppError("conflict", "Player left during matching")
        game_id, _, _, group_name = segment.split(":")
        game = live_game(game_id)
        if game is None:
            raise AppError("conflict", "Game no longer available")
        anchor = group[0]
        host = member_info_from_user(users[anchor["user"]])
        members = [member_info_from_user(users[t["user"]]) for t in group[1:]]
        activity = {"kind": game.kind, "gameId": game.id, "difficulty": anchor["difficulty"]}
        doc = await self.infra.services.rooms.create_for_match(op, room_id, host, members, activity, group_name)
        await self._finish(segment, op, [t["id"] for t in group], doc["room"]["code"], room_id)

    async def _finish(self, segment: str, op: str, tids: list[str], code: str, room_id: str) -> None:
        r = self.infra.redis
        ticket_keys = [keys.mm_ticket(segment, tid) for tid in tids]
        await self.infra.scripts.finish_tickets(keys=ticket_keys, args=[op, code, room_id])
        await r.hdel(keys.mm_claims(segment), op)  # type: ignore[misc]
        rows = [await r.hgetall(k) for k in ticket_keys]  # type: ignore[misc]
        now = now_ms()
        game_id = segment.split(":")[0]
        hour = hour_label(now)
        pipe = r.pipeline(transaction=False)
        pipe.incr(keys.metric_hourly("matches", hour))
        pipe.expire(keys.metric_hourly("matches", hour), 26 * 3600)
        pipe.incr(keys.metric_hourly(f"matches:{game_id}", hour))
        pipe.expire(keys.metric_hourly(f"matches:{game_id}", hour), 26 * 3600)
        for row in rows:
            if row.get("enq"):
                wait = (now - int(row["enq"])) / 1000
                metrics.observe("mm_match_wait_seconds", wait, game=game_id)
                pipe.lpush(keys.metric_samples("wait", game_id), round(wait, 2))
        pipe.ltrim(keys.metric_samples("wait", game_id), 0, 199)
        await pipe.execute()
        metrics.inc("mm_matches_total", game=game_id)
        for tid, row in zip(tids, rows, strict=True):
            if row.get("status") == "matched" and row.get("op") == op:
                await self._notify(row["user"], tid, "matched", code)
                if await r.get(keys.mm_user_ticket(row["user"])) == tid:
                    await r.delete(keys.mm_user_ticket(row["user"]))

    async def _release(self, segment: str, op: str, tids: list[str]) -> None:
        ticket_keys = [keys.mm_ticket(segment, tid) for tid in tids]
        await self.infra.scripts.release_tickets(keys=[keys.mm_queue(segment), *ticket_keys], args=[op, *tids])
        await self.infra.redis.hdel(keys.mm_claims(segment), op)  # type: ignore[misc]
        metrics.inc("mm_claims_released_total")

    async def recover_claims(self) -> int:
        """Finish or roll back claims whose worker stopped mid-match. Returns claims handled."""
        handled = 0
        lease = self.s.match_claim_lease_sec * 1000
        segments: set[str] = await self.infra.redis.smembers(keys.mm_segments())  # type: ignore[misc]
        for segment in segments:
            claims: dict[str, str] = await self.infra.redis.hgetall(keys.mm_claims(segment))  # type: ignore[misc]
            for op, raw in claims.items():
                info = json.loads(raw)
                if now_ms() - int(info["at"]) < lease:
                    continue
                room_id = await self.infra.redis.get(keys.mm_op(op))
                doc = await self.infra.services.rooms.load(room_id) if room_id else None
                if doc is not None and doc["meta"].get("matchOp") == op:
                    await self._finish(segment, op, info["tickets"], doc["room"]["code"], doc["room"]["id"])
                else:
                    await self._release(segment, op, info["tickets"])
                handled += 1
        return handled

    async def loop(self, stop: asyncio.Event, interval: float = 0.5) -> None:
        while not stop.is_set():
            try:
                await self.match_once()
                await self.recover_claims()
            except RedisError:
                metrics.inc("redis_errors_total", kind="matcher")
            except Exception as e:
                report_exception(e, loop="matcher")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), interval)


def form_groups(active: list[dict[str, Any]], size: int, blocked: set[frozenset[str]]) -> list[list[dict[str, Any]]]:
    """Greedy, oldest-first grouping. Pure function (unit tested).

    - Never puts two tickets of the same user, or a blocked pair, in one group.
    - Difficulty must match the anchor's unless every member has widened.
    - Among tickets within the same 10 s wait window, shared interests rank higher.
    """
    remaining = sorted(active, key=lambda t: int(t["enq"]))
    groups: list[list[dict[str, Any]]] = []
    while len(remaining) >= size:
        anchor = remaining[0]
        anchor_interests = set(json.loads(anchor.get("interests") or "[]"))

        def rank(t: dict[str, Any], ai: set[str] = anchor_interests) -> tuple[int, int]:
            shared = len(ai & set(json.loads(t.get("interests") or "[]")))
            return int(t["enq"]) // INTEREST_TIE_WINDOW_MS, -shared

        group = [anchor]
        for t in sorted(remaining[1:], key=rank):
            if any(t["user"] == g["user"] or frozenset((t["user"], g["user"])) in blocked for g in group):
                continue
            same_difficulty = t["difficulty"] == anchor["difficulty"]
            all_widened = t.get("widened") == "1" and all(g.get("widened") == "1" for g in group)
            if not (same_difficulty or all_widened):
                continue
            group.append(t)
            if len(group) == size:
                break
        if len(group) == size:
            groups.append(group)
            ids = {g["id"] for g in group}
            remaining = [t for t in remaining if t["id"] not in ids]
        else:
            remaining = remaining[1:]
    return groups
