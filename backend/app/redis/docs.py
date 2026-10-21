"""Versioned JSON documents in Redis with optimistic concurrency.

A document is a HASH ``{v: <int>, d: <json>}``. ``update`` reads it, applies a
pure Python mutation and writes back with compare-and-set, retrying when
another worker wrote in between. This makes every read-modify-write on rooms
and solo sessions atomic across workers without holding locks.
"""

from __future__ import annotations

import asyncio
import json
import random
from collections.abc import Callable
from typing import Any, TypeVar

from redis.asyncio import Redis

from app.errors import AppError
from app.observability import metrics
from app.redis.scripts import Scripts

T = TypeVar("T")
Doc = dict[str, Any]


class DocStore:
    def __init__(self, redis: Redis, scripts: Scripts) -> None:
        self.redis = redis
        self.scripts = scripts

    async def get(self, key: str) -> tuple[int, Doc] | None:
        raw: dict[str, str] = await self.redis.hgetall(key)  # type: ignore[misc]
        if not raw or "v" not in raw:
            return None
        return int(raw["v"]), json.loads(raw["d"])

    async def create(self, key: str, doc: Doc, ttl_ms: int) -> bool:
        res = await self.scripts.cas_set(keys=[key], args=[0, json.dumps(doc, separators=(",", ":")), ttl_ms])
        return int(res) > 0

    async def update(
        self,
        key: str,
        mutate: Callable[[Doc], T],
        ttl_ms: int,
        *,
        missing: AppError | None = None,
        retries: int = 12,
    ) -> T:
        """Apply ``mutate`` atomically. ``mutate`` edits the doc in place and returns a result.

        It may raise ``AppError`` to abort without writing. It must not have side effects
        outside the doc, because it can run more than once.
        """
        for attempt in range(retries):
            current = await self.get(key)
            if current is None:
                raise missing or AppError("not_found", "Not found.")
            version, doc = current
            result = mutate(doc)
            res = await self.scripts.cas_set(keys=[key], args=[version, json.dumps(doc, separators=(",", ":")), ttl_ms])
            if int(res) > 0:
                return result
            metrics.inc("cas_conflicts_total")
            await asyncio.sleep(random.uniform(0, 0.004 * (attempt + 1)))
        raise AppError("conflict", "Too many simultaneous changes. Please retry.")

    async def delete(self, key: str) -> None:
        await self.redis.delete(key)
