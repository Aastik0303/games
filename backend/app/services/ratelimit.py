"""Redis fixed-window rate limits, shared by every worker.

Policies are named so ``GET /v1/me/rate-limits`` can report them. When Redis
is down, limits fail closed (the caller gets 503), because the operations they
protect can't run without Redis anyway.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.errors import AppError
from app.infra import Infra
from app.observability import metrics
from app.redis import keys


@dataclass(frozen=True)
class Policy:
    limit: int
    window_sec: int
    message: str = "You're going a little fast. Try again shortly."


POLICIES: dict[str, Policy] = {
    "session_create": Policy(10, 600),
    "room_create": Policy(10, 600),
    "room_join": Policy(20, 60),
    # Unknown codes: tight per user and per IP so 8-char codes can't be enumerated.
    "room_code_miss_user": Policy(10, 600, "Too many wrong room codes. Try again in a few minutes."),
    "room_code_miss_ip": Policy(30, 600, "Too many wrong room codes. Try again in a few minutes."),
    "matchmaking": Policy(20, 60),
    "ws_ticket": Policy(30, 60),
    "ws_connect_ip": Policy(60, 60),
    "solo_action": Policy(60, 60),
    "report": Policy(5, 600, "You've sent several reports recently. Our team will review them."),
    "block": Policy(30, 600),
    "chat": Policy(5, 10, "Slow down — you can send 5 messages every 10 seconds"),
    "reaction": Policy(8, 10, "Easy there — too many reactions"),
    "watch_control": Policy(20, 10, "Too many playback changes"),
    "game_submit": Policy(20, 10, "Too many answers too quickly"),
    "admin_write": Policy(60, 60),
}


class RateLimiter:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra

    async def hit(self, policy_name: str, subject: str) -> None:
        """Count one event; raise ``rate_limited`` (429 + Retry-After) when over the limit."""
        p = POLICIES[policy_name]
        res = await self.infra.scripts.rate_limit(keys=[keys.rate(policy_name, subject)], args=[p.limit, p.window_sec * 1000])
        count, ttl_ms = int(res[0]), int(res[1])
        if count > p.limit:
            metrics.inc("rate_limited_total", policy=policy_name)
            raise AppError("rate_limited", p.message, retry_after=max(1, math.ceil(ttl_ms / 1000)))

    async def check(self, policy_name: str, subject: str) -> None:
        """Raise if already over the limit, without counting."""
        p = POLICIES[policy_name]
        key = keys.rate(policy_name, subject)
        raw = await self.infra.redis.get(key)
        if raw is not None and int(raw) >= p.limit:
            ttl = await self.infra.redis.pttl(key)
            metrics.inc("rate_limited_total", policy=policy_name)
            raise AppError("rate_limited", p.message, retry_after=max(1, math.ceil(max(ttl, 0) / 1000)))

    async def status(self, policy_name: str, subject: str) -> dict[str, int]:
        p = POLICIES[policy_name]
        key = keys.rate(policy_name, subject)
        raw = await self.infra.redis.get(key)
        ttl = await self.infra.redis.pttl(key)
        used = int(raw) if raw else 0
        return {
            "limit": p.limit,
            "windowSec": p.window_sec,
            "remaining": max(0, p.limit - used),
            "resetInSec": max(0, math.ceil(ttl / 1000)) if used else 0,
        }
