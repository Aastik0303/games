"""Shared infrastructure handles, built once per process in the app lifespan."""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.config import Settings
from app.redis.docs import DocStore
from app.redis.scripts import Scripts


@dataclass
class Infra:
    settings: Settings
    redis: Redis
    engine: AsyncEngine
    db: async_sessionmaker[AsyncSession]
    scripts: Scripts = field(init=False)
    docs: DocStore = field(init=False)
    # Late-bound services (set by app.services.container.build_services).
    services: Any = None

    def __post_init__(self) -> None:
        self.scripts = Scripts(self.redis)
        self.docs = DocStore(self.redis, self.scripts)


def new_id(prefix: str, nbytes: int = 8) -> str:
    return f"{prefix}_{secrets.token_hex(nbytes)}"


def avatar_hue(user_id: str) -> int:
    """Same deterministic hue as the frontend's mock (hueFor)."""
    h = 0
    for ch in user_id:
        h = (h * 31 + ord(ch)) % 360
    return h
