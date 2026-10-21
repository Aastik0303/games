"""Operator CLI: audited role grants (no backdoor accounts) and the retention job."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app import cli
from app.config import get_settings
from app.db.models import AuditEvent, Base, Block, Report, User
from app.db.session import create_engine, create_sessionmaker
from app.schemas.common import utcnow


@pytest.fixture
def db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    url = f"sqlite+aiosqlite:///{(tmp_path / 'cli.db').as_posix()}"
    monkeypatch.setenv("PRISM_DATABASE_URL", url)
    get_settings.cache_clear()
    yield url
    get_settings.cache_clear()


def _user(uid: str, last_seen_days: int) -> User:
    t = utcnow() - timedelta(days=last_seen_days)
    return User(
        id=uid,
        display_name=uid,
        avatar_hue=1,
        age_band="25_34",
        is_minor=False,
        language="en",
        interests=[],
        accessibility={},
        matching={},
        consent_guidelines_at=t,
        consent_interests=False,
        privacy={},
        roles=["player"],
        status="active",
        created_at=t,
        updated_at=t,
        last_seen_at=t,
    )


async def _seed(url: str) -> None:
    engine = create_engine(get_settings())
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    db = create_sessionmaker(engine)
    old = utcnow() - timedelta(days=400)
    async with db() as s:
        s.add_all([_user("u_fresh", 1), _user("u_stale", 45)])
        s.add(Block(blocker_id="u_fresh", blocked_id="u_stale", blocked_display_name="x", blocked_avatar_hue=1, created_at=old))
        s.add(
            Report(
                id="rep_old",
                reporter_id="u_fresh",
                target_id="u_stale",
                target_display_name="x",
                target_avatar_hue=1,
                reason="spam",
                details="private words",
                status="dismissed",
                priority="normal",
                created_at=old,
                resolved_at=old,
            )
        )
        s.add(
            Report(
                id="rep_mid",
                reporter_id="u_fresh",
                target_id="u_stale",
                target_display_name="x",
                target_avatar_hue=1,
                reason="spam",
                details="private words",
                message_excerpt="msg",
                status="actioned",
                priority="normal",
                created_at=utcnow() - timedelta(days=120),
                resolved_at=utcnow() - timedelta(days=100),
            )
        )
        s.add(
            Report(
                id="rep_open",
                reporter_id="u_fresh",
                target_id="u_stale",
                target_display_name="x",
                target_avatar_hue=1,
                reason="spam",
                details="keep me",
                status="open",
                priority="normal",
                created_at=old,
            )
        )
        await s.commit()
    await engine.dispose()


def test_grant_role_is_audited_and_retention_applies(db_url: str) -> None:
    asyncio.run(_seed(db_url))
    asyncio.run(cli.set_role("u_fresh", "moderator", "alice OPS-1", grant=True))
    out = asyncio.run(cli.retention())
    assert out["guest_profiles_deleted"] == 1 and out["reports_deleted"] == 1 and out["report_text_redacted"] >= 1

    async def check() -> None:
        engine = create_engine(get_settings())
        db = create_sessionmaker(engine)
        async with db() as s:
            fresh = await s.get(User, "u_fresh")
            assert fresh is not None and fresh.roles == ["moderator", "player"]
            assert await s.get(User, "u_stale") is None
            assert (await s.execute(select(Block))).first() is None
            mid = await s.get(Report, "rep_mid")
            assert mid is not None and mid.details is None and mid.message_excerpt is None
            still_open = await s.get(Report, "rep_open")
            assert still_open is not None and still_open.details == "keep me"
            grant = (await s.execute(select(AuditEvent))).scalars().one()
            assert grant.action == "role.grant" and grant.actor_id == "cli:alice OPS-1" and grant.target_id == "u_fresh"
        await engine.dispose()

    asyncio.run(check())
