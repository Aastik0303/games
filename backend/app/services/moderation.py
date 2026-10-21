"""Reports, blocks and moderator actions. All durable (database) and audited."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.db.models import Block, Report, User
from app.errors import AppError
from app.infra import Infra, new_id
from app.observability import metrics
from app.redis import keys
from app.schemas.common import iso, utcnow
from app.schemas.moderation import HIGH_PRIORITY_REASONS, ReportInput
from app.services import audit
from app.services.rooms import find
from app.services.sessions import Principal

SUSPENSION = timedelta(days=7)


def report_out(r: Report) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": r.id,
        "reason": r.reason,
        "details": r.details,
        "target": {"id": r.target_id, "displayName": r.target_display_name, "avatarHue": r.target_avatar_hue, "isBot": False},
        "reporterId": r.reporter_id,
        "roomCode": r.room_code,
        "messageExcerpt": r.message_excerpt,
        "status": r.status,
        "priority": r.priority,
        "createdAt": iso(r.created_at),
    }
    if r.resolution_action and r.resolved_at:
        out["resolution"] = {"action": r.resolution_action, "note": r.resolution_note or "", "at": iso(r.resolved_at)}
    return {k: v for k, v in out.items() if v is not None}


class ModerationService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra

    # --- blocks -----------------------------------------------------------------
    async def block(self, principal: Principal, target_id: str) -> None:
        if target_id == principal.id:
            raise AppError("validation", "You can't block yourself.")
        await self.infra.services.ratelimit.hit("block", principal.id)
        async with self.infra.db() as db:
            target = await db.get(User, target_id)
            if target is None:
                raise AppError("not_found", "Player not found.")
            if await db.get(Block, (principal.id, target_id)) is None:
                db.add(
                    Block(
                        blocker_id=principal.id,
                        blocked_id=target_id,
                        blocked_display_name=target.display_name,
                        blocked_avatar_hue=target.avatar_hue,
                        created_at=utcnow(),
                    )
                )
                try:
                    await db.commit()
                except IntegrityError:
                    await db.rollback()  # concurrent duplicate: already blocked
        metrics.inc("blocks_total")
        await self.infra.services.events.publish_user(principal.id, "_blocks.changed", {})

    async def unblock(self, principal: Principal, target_id: str) -> None:
        async with self.infra.db() as db:
            row = await db.get(Block, (principal.id, target_id))
            if row is not None:
                await db.delete(row)
                await db.commit()
        await self.infra.services.events.publish_user(principal.id, "_blocks.changed", {})

    async def list_blocked(self, principal: Principal) -> list[dict[str, Any]]:
        async with self.infra.db() as db:
            rows = (
                (await db.execute(select(Block).where(Block.blocker_id == principal.id).order_by(Block.created_at)))
                .scalars()
                .all()
            )
        return [
            {"id": b.blocked_id, "displayName": b.blocked_display_name, "avatarHue": b.blocked_avatar_hue, "isBot": False}
            for b in rows
        ]

    async def blocked_ids(self, user_id: str) -> set[str]:
        async with self.infra.db() as db:
            rows = (await db.execute(select(Block.blocked_id).where(Block.blocker_id == user_id))).scalars().all()
        return set(rows)

    async def block_pairs(self, user_ids: list[str]) -> set[frozenset[str]]:
        """Every (a, b) among ``user_ids`` where either blocked the other."""
        ids = list(set(user_ids))
        if len(ids) < 2:
            return set()
        async with self.infra.db() as db:
            rows = (
                await db.execute(
                    select(Block.blocker_id, Block.blocked_id).where(Block.blocker_id.in_(ids), Block.blocked_id.in_(ids))
                )
            ).all()
        return {frozenset((a, b)) for a, b in rows}

    async def any_block_between(self, user_id: str, others: list[str]) -> bool:
        if not others:
            return False
        async with self.infra.db() as db:
            row = (
                await db.execute(
                    select(Block.blocker_id)
                    .where(
                        or_(
                            (Block.blocker_id == user_id) & Block.blocked_id.in_(others),
                            (Block.blocked_id == user_id) & Block.blocker_id.in_(others),
                        )
                    )
                    .limit(1)
                )
            ).first()
        return row is not None

    # --- reports ------------------------------------------------------------------
    async def report(self, principal: Principal, data: ReportInput) -> str:
        if data.target_user_id == principal.id:
            raise AppError("validation", "You can't report yourself.")
        await self.infra.services.ratelimit.hit("report", principal.id)
        room_code = excerpt = None
        target_public: dict[str, Any] | None = None
        if data.room_id:
            doc = await self.infra.services.rooms.load(data.room_id)
            # Room context only counts if the reporter is in that room (no probing other rooms).
            if doc is not None and find(doc, principal.id):
                room_code = doc["room"]["code"]
                p = find(doc, data.target_user_id)
                target_public = p["user"] if p else None
                if data.message_id:
                    msg = await self.infra.services.rooms.find_message(data.room_id, data.message_id)
                    if msg and msg["author"]["id"] == data.target_user_id:
                        excerpt = msg["text"][:140]
                        target_public = target_public or msg["author"]
        async with self.infra.db() as db:
            target = await db.get(User, data.target_user_id)
            if target is None and target_public is None:
                raise AppError("not_found", "Player not found.")
            name = target.display_name if target else str(target_public["displayName"])  # type: ignore[index]
            hue = target.avatar_hue if target else int(target_public["avatarHue"])  # type: ignore[index]
            report = Report(
                id=new_id("rep"),
                reporter_id=principal.id,
                target_id=data.target_user_id,
                target_display_name=name,
                target_avatar_hue=hue,
                reason=data.reason,
                details=(data.details or "").strip() or None,
                room_id=data.room_id if room_code else None,
                room_code=room_code,
                message_id=data.message_id if excerpt else None,
                message_excerpt=excerpt,
                status="open",
                priority="high" if data.reason in HIGH_PRIORITY_REASONS else "normal",
                created_at=utcnow(),
            )
            db.add(report)
            await db.commit()
        metrics.inc("reports_total", reason=data.reason)
        return report.id

    async def list_reports(self, status: str) -> list[dict[str, Any]]:
        async with self.infra.db() as db:
            q = select(Report)
            q = q.where(Report.status == "open") if status == "open" else q.where(Report.status != "open")
            rows = (await db.execute(q.order_by(Report.created_at.desc()).limit(200))).scalars().all()
        rows = sorted(rows, key=lambda r: (r.status != "open" or r.priority != "high",))
        return [report_out(r) for r in rows]

    async def resolve(self, actor: Principal, report_id: str, action: str, note: str) -> dict[str, Any]:
        note = note.strip()
        if action in ("suspend", "remove_content") and len(note) < 3:
            raise AppError("validation", "Add a short reason for this action.", fields={"note": "Required"})
        async with self.infra.db() as db:
            report = await db.get(Report, report_id)
            if report is None:
                raise AppError("not_found", "Report not found.")
            if report.status != "open":
                raise AppError("conflict", "This report was already resolved.")
            if report.target_id == actor.id:
                raise AppError("forbidden", "You can't resolve a report about yourself.")
            report.status = "dismissed" if action == "dismiss" else "actioned"
            report.resolution_action, report.resolution_note = action, note
            report.resolved_at, report.resolved_by = utcnow(), actor.id
            target = await db.get(User, report.target_id)
            if action == "suspend" and target is not None:
                if "admin" in (target.roles or []):
                    raise AppError("forbidden", "Admins can't be suspended from the moderation queue.")
                target.status, target.suspended_until = "suspended", utcnow() + SUSPENSION
            audit.record(
                db,
                actor_id=actor.id,
                action=f"report.{action}",
                target_type="report",
                target_id=report.id,
                reason=note,
                data={"targetUserId": report.target_id},
            )
            await db.commit()
            out = report_out(report)
            room_id, message_id, target_id = report.room_id, report.message_id, report.target_id
        await self._apply(action, target_id, room_id, message_id)
        metrics.inc("reports_resolved_total", action=action)
        return out

    async def _apply(self, action: str, target_id: str, room_id: str | None, message_id: str | None) -> None:
        events = self.infra.services.events
        if action == "remove_content" and room_id and message_id:
            await self.infra.services.rooms.remove_message(room_id, message_id)
        if action in ("warn", "remove_content", "suspend"):
            notice = {
                "warn": "A moderator reviewed a report about your behaviour. Please follow the community guidelines.",
                "remove_content": "A moderator removed one of your messages for breaking the community guidelines.",
                "suspend": "Your account has been suspended for breaking the community guidelines.",
            }[action]
            await events.publish_user(target_id, "moderation.notice", {"action": action, "message": notice})
        if action == "suspend":
            await self.infra.services.matchmaking.cancel_for_user(target_id)
            room_ids: set[str] = await self.infra.redis.smembers(keys.user_rooms(target_id))  # type: ignore[misc]
            for rid in room_ids:
                try:
                    await self.infra.services.rooms.remove_member(rid, target_id, "kicked", ban=True)
                except AppError:
                    continue
            await self.infra.services.sessions.revoke_all(target_id)
