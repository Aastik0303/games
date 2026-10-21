"""Feature flags and the game catalog (code-defined games + operator overrides in the database).

Both are read on hot paths (every room command checks a flag), so each worker
caches them for a few seconds. Writes invalidate the local cache immediately;
other workers pick the change up within ``CACHE_SEC``.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select

from app.db.models import FeatureFlagRow, GameSetting
from app.errors import AppError
from app.games.engine import GameDefinition
from app.games.registry import GAMES
from app.infra import Infra
from app.schemas.common import iso, utcnow
from app.services import audit

CACHE_SEC = 3.0

DEFAULT_FLAGS: dict[str, tuple[str, bool]] = {
    "multiplayer": ("Matchmaking and multiplayer game rooms", True),
    "watchTogether": ("Synchronized Watch Together rooms", True),
    "screenShare": ("Browser screen-share capture (local preview until a media server exists)", True),
    "reactions": ("Emoji reactions in rooms", True),
    "chat": ("Text chat in rooms", True),
}


class FlagService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra
        self._cache: tuple[float, list[dict[str, Any]]] | None = None

    async def ensure_defaults(self) -> None:
        async with self.infra.db() as db:
            existing = {r.key for r in (await db.execute(select(FeatureFlagRow))).scalars()}
            for key, (desc, enabled) in DEFAULT_FLAGS.items():
                if key not in existing:
                    db.add(FeatureFlagRow(key=key, description=desc, enabled=enabled, updated_at=utcnow()))
            await db.commit()

    async def list(self) -> list[dict[str, Any]]:
        if self._cache and time.monotonic() - self._cache[0] < CACHE_SEC:
            return self._cache[1]
        async with self.infra.db() as db:
            rows = (await db.execute(select(FeatureFlagRow))).scalars().all()
        flags = [
            {"key": r.key, "description": r.description, "enabled": r.enabled, "updatedAt": iso(r.updated_at)}
            for r in sorted(rows, key=lambda r: list(DEFAULT_FLAGS).index(r.key) if r.key in DEFAULT_FLAGS else 99)
            if r.key in DEFAULT_FLAGS
        ]
        self._cache = (time.monotonic(), flags)
        return flags

    async def as_map(self) -> dict[str, bool]:
        flags = {f["key"]: f["enabled"] for f in await self.list()}
        return {k: flags.get(k, v[1]) for k, v in DEFAULT_FLAGS.items()}

    async def enabled(self, key: str) -> bool:
        return (await self.as_map()).get(key, False)

    async def require(self, key: str, message: str) -> None:
        if not await self.enabled(key):
            raise AppError("forbidden", message)

    async def set(self, key: str, enabled: bool, actor_id: str) -> dict[str, Any]:
        if key not in DEFAULT_FLAGS:
            raise AppError("not_found", "Unknown flag.")
        async with self.infra.db() as db:
            row = await db.get(FeatureFlagRow, key)
            if row is None:
                row = FeatureFlagRow(key=key, description=DEFAULT_FLAGS[key][0], enabled=enabled, updated_at=utcnow())
                db.add(row)
            before = row.enabled
            row.enabled, row.updated_at, row.updated_by = enabled, utcnow(), actor_id
            audit.record(
                db, actor_id=actor_id, action="flag.set", target_type="flag", target_id=key, data={"from": before, "to": enabled}
            )
            await db.commit()
        self._cache = None
        return {"key": row.key, "description": row.description, "enabled": row.enabled, "updatedAt": iso(row.updated_at)}


class CatalogService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra
        self._cache: tuple[float, dict[str, dict[str, Any]]] | None = None

    async def _all(self) -> dict[str, dict[str, Any]]:
        if self._cache and time.monotonic() - self._cache[0] < CACHE_SEC:
            return self._cache[1]
        async with self.infra.db() as db:
            overrides = {r.game_id: r for r in (await db.execute(select(GameSetting))).scalars()}
        out: dict[str, dict[str, Any]] = {}
        for gid, game in GAMES.items():
            s = game.summary()
            o = overrides.get(gid)
            if o is not None:
                s["enabled"] = o.enabled
                s["difficulties"] = [d for d in game.difficulties if d in o.difficulties] or list(game.difficulties)
            out[gid] = s
        self._cache = (time.monotonic(), out)
        return out

    async def list_enabled(self) -> list[dict[str, Any]]:
        return [g for g in (await self._all()).values() if g["enabled"]]

    async def list_all(self) -> list[dict[str, Any]]:
        return list((await self._all()).values())

    async def get_enabled(self, game_id: str) -> tuple[dict[str, Any], GameDefinition]:
        summary = (await self._all()).get(game_id)
        if summary is None or not summary["enabled"]:
            raise AppError("not_found", "That game isn't available.")
        return summary, GAMES[game_id]

    async def update(
        self, game_id: str, enabled: bool | None, difficulties: Sequence[str] | None, actor_id: str
    ) -> dict[str, Any]:
        game = GAMES.get(game_id)
        if game is None:
            raise AppError("not_found", "Game not found.")
        if difficulties is not None:
            if not difficulties:
                raise AppError("validation", "Keep at least one difficulty.", fields={"difficulties": "Required"})
            unknown = set(difficulties) - set(game.difficulties)
            if unknown:
                raise AppError("validation", f"{game.title} has no {', '.join(sorted(unknown))} puzzles.")
        current = (await self._all())[game_id]
        async with self.infra.db() as db:
            row = await db.get(GameSetting, game_id)
            if row is None:
                row = GameSetting(
                    game_id=game_id, enabled=current["enabled"], difficulties=current["difficulties"], updated_at=utcnow()
                )
                db.add(row)
            before = {"enabled": row.enabled, "difficulties": list(row.difficulties)}
            if enabled is not None:
                row.enabled = enabled
            if difficulties is not None:
                row.difficulties = list(dict.fromkeys(difficulties))
            row.updated_at, row.updated_by = utcnow(), actor_id
            audit.record(
                db,
                actor_id=actor_id,
                action="catalog.update",
                target_type="game",
                target_id=game_id,
                data={"from": before, "to": {"enabled": row.enabled, "difficulties": row.difficulties}},
            )
            await db.commit()
        self._cache = None
        return (await self._all())[game_id]
