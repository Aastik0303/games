"""Distributed one-shot timers (round deadlines, reveal delays).

Jobs live in a Redis sorted set scored by due time. Every worker polls; a Lua
script moves due jobs to an in-flight set with a lease, so exactly one worker
runs each job. If that worker dies, the lease expires and the job is
requeued — so handlers must be idempotent (they check the room's run id,
round and phase before acting, and a stale job is a no-op).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from redis.exceptions import RedisError

from app.errors import AppError
from app.infra import Infra
from app.observability import metrics, report_exception
from app.redis import keys

log = logging.getLogger("prism.timers")
Handler = Callable[[dict[str, Any]], Awaitable[None]]
LEASE_MS = 10_000
POLL_SEC = 0.1


class TimerService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra
        self.handlers: dict[str, Handler] = {}

    def register(self, kind: str, handler: Handler) -> None:
        self.handlers[kind] = handler

    async def schedule(self, kind: str, delay_ms: int, **data: Any) -> None:
        job = json.dumps({"jid": uuid.uuid4().hex, "k": kind, **data}, separators=(",", ":"))
        await self.infra.redis.zadd(keys.timers_due(), {job: int(time.time() * 1000) + max(0, delay_ms)})

    async def run_due(self, limit: int = 50) -> int:
        """Claim and run due jobs once. Returns how many ran."""
        now = int(time.time() * 1000)
        await self.infra.scripts.requeue_timers(keys=[keys.timers_due(), keys.timers_inflight()], args=[now])
        jobs: list[str] = await self.infra.scripts.claim_timers(
            keys=[keys.timers_due(), keys.timers_inflight()], args=[now, LEASE_MS, limit]
        )
        for raw in jobs:
            job = json.loads(raw)
            handler = self.handlers.get(job.get("k", ""))
            try:
                if handler:
                    await handler(job)
                metrics.inc("timer_jobs_total", kind=job.get("k", "?"), result="ok")
            except RedisError:
                # Leave it in flight: the lease expires and another attempt runs.
                metrics.inc("timer_jobs_total", kind=job.get("k", "?"), result="redis_error")
                continue
            except AppError as e:
                metrics.inc("timer_jobs_total", kind=job.get("k", "?"), result=e.code)
            except Exception as e:
                metrics.inc("timer_jobs_total", kind=job.get("k", "?"), result="error")
                report_exception(e, job_kind=job.get("k"))
            await self.infra.redis.zrem(keys.timers_inflight(), raw)
        return len(jobs)

    async def loop(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                ran = await self.run_due()
            except RedisError:
                metrics.inc("redis_errors_total", kind="timer_loop")
                ran = 0
                await asyncio.sleep(1)
            except Exception as e:
                report_exception(e, loop="timers")
                ran = 0
                await asyncio.sleep(1)
            if not ran:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), POLL_SEC)
