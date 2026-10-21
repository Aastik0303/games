"""Operator commands. There is no built-in or default admin account: roles are
granted to an existing guest profile by someone with database access, and every
grant is written to the audit log.

    python -m app.cli grant-role --user u_123 --role admin --operator "alice (ticket OPS-42)"
    python -m app.cli revoke-role --user u_123 --role admin --operator alice
    python -m app.cli retention            # apply the data-retention policy (run daily)
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import timedelta

from sqlalchemy import delete, select, update

from app.config import get_settings
from app.db.models import AuditEvent, Block, Report, User
from app.db.session import create_engine, create_sessionmaker
from app.schemas.common import utcnow
from app.services import audit

ROLES = ("admin", "moderator")
# Retention policy (docs/OPERATIONS.md). Durations are deliberately short for guest data.
GUEST_INACTIVE_DAYS = 30
REPORT_TEXT_DAYS = 90
REPORT_DELETE_DAYS = 365
AUDIT_DAYS = 730


async def set_role(user_id: str, role: str, operator: str, grant: bool) -> None:
    engine = create_engine(get_settings())
    db = create_sessionmaker(engine)
    async with db() as s:
        user = await s.get(User, user_id)
        if user is None:
            raise SystemExit(f"No user {user_id}")
        roles = set(user.roles or ["player"])
        if grant:
            roles.add(role)
        else:
            roles.discard(role)
        user.roles = sorted(roles | {"player"})
        audit.record(
            s,
            actor_id=f"cli:{operator}"[:40],
            action="role.grant" if grant else "role.revoke",
            target_type="user",
            target_id=user_id,
            reason=operator,
            data={"role": role},
        )
        await s.commit()
    await engine.dispose()
    print(f"{user_id}: roles = {user.roles}")


async def retention() -> dict[str, int]:
    engine = create_engine(get_settings())
    db = create_sessionmaker(engine)
    now = utcnow()
    out: dict[str, int] = {}
    async with db() as s:
        stale = (
            (
                await s.execute(
                    select(User.id).where(
                        User.last_seen_at < now - timedelta(days=GUEST_INACTIVE_DAYS),
                        User.status == "active",
                    )
                )
            )
            .scalars()
            .all()
        )
        if stale:
            await s.execute(delete(Block).where(Block.blocker_id.in_(stale) | Block.blocked_id.in_(stale)))
            await s.execute(delete(User).where(User.id.in_(stale)))
        out["guest_profiles_deleted"] = len(stale)
        res = await s.execute(
            update(Report)
            .where(
                Report.status != "open",
                Report.resolved_at < now - timedelta(days=REPORT_TEXT_DAYS),
            )
            .values(details=None, message_excerpt=None)
        )
        out["report_text_redacted"] = int(res.rowcount or 0)
        res = await s.execute(
            delete(Report).where(Report.status != "open", Report.resolved_at < now - timedelta(days=REPORT_DELETE_DAYS))
        )
        out["reports_deleted"] = int(res.rowcount or 0)
        res = await s.execute(delete(AuditEvent).where(AuditEvent.created_at < now - timedelta(days=AUDIT_DAYS)))
        out["audit_events_deleted"] = int(res.rowcount or 0)
        await s.commit()
    await engine.dispose()
    return out


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("grant-role", "revoke-role"):
        p = sub.add_parser(name)
        p.add_argument("--user", required=True)
        p.add_argument("--role", required=True, choices=ROLES)
        p.add_argument("--operator", required=True, help="Who is doing this, and why (stored in the audit log)")
    sub.add_parser("retention")
    args = parser.parse_args()
    if args.cmd in ("grant-role", "revoke-role"):
        asyncio.run(set_role(args.user, args.role, args.operator, args.cmd == "grant-role"))
    else:
        print(asyncio.run(retention()))


if __name__ == "__main__":
    main()
