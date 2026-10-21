"""Wires services together and runs the background workers."""

from __future__ import annotations

import asyncio
import contextlib
import secrets
from dataclasses import dataclass, field

from redis.exceptions import RedisError

from app.infra import Infra
from app.observability import metrics, report_exception
from app.redis import keys
from app.services.admin import AdminService
from app.services.catalog import CatalogService, FlagService
from app.services.events import EventBus
from app.services.live import LiveGameService
from app.services.matchmaking import MatchmakingService
from app.services.moderation import ModerationService
from app.services.ratelimit import RateLimiter
from app.services.rooms import RoomService
from app.services.sessions import SessionService
from app.services.solo import SoloService
from app.services.timers import TimerService

SWEEP_INTERVAL_SEC = 5.0


@dataclass
class Services:
    ratelimit: RateLimiter
    sessions: SessionService
    flags: FlagService
    catalog: CatalogService
    events: EventBus
    timers: TimerService
    rooms: RoomService
    solo: SoloService
    matchmaking: MatchmakingService
    moderation: ModerationService
    admin: AdminService
    live: LiveGameService = field(init=False)


def build_services(infra: Infra) -> Services:
    services = Services(
        ratelimit=RateLimiter(infra),
        sessions=SessionService(infra),
        flags=FlagService(infra),
        catalog=CatalogService(infra),
        events=EventBus(infra),
        timers=TimerService(infra),
        rooms=RoomService(infra),
        solo=SoloService(infra),
        matchmaking=MatchmakingService(infra),
        moderation=ModerationService(infra),
        admin=AdminService(infra),
    )
    infra.services = services
    services.live = LiveGameService(infra)  # registers its timer handler
    return services


class BackgroundWorkers:
    """Matcher, timer runner and sweeper. Every instance runs them; Redis keeps them from colliding."""

    def __init__(self, infra: Infra) -> None:
        self.infra = infra
        self.stop = asyncio.Event()
        self.tasks: list[asyncio.Task[None]] = []

    def start(self) -> None:
        s = self.infra.services
        self.tasks = [
            asyncio.create_task(s.timers.loop(self.stop), name="timers"),
            asyncio.create_task(s.matchmaking.loop(self.stop), name="matcher"),
            asyncio.create_task(self._sweeper(), name="sweeper"),
        ]

    async def _sweeper(self) -> None:
        owner = secrets.token_hex(8)
        while not self.stop.is_set():
            try:
                # One sweeper per interval across all workers.
                got = await self.infra.redis.set(
                    keys.worker_lock("sweeper"), owner, nx=True, px=int(SWEEP_INTERVAL_SEC * 1000 * 0.8)
                )
                if got:
                    await self.infra.services.rooms.sweep()
                    metrics.inc("sweeps_total")
            except RedisError:
                metrics.inc("redis_errors_total", kind="sweeper")
            except Exception as e:
                report_exception(e, loop="sweeper")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self.stop.wait(), SWEEP_INTERVAL_SEC)

    async def shutdown(self) -> None:
        self.stop.set()
        for t in self.tasks:
            with contextlib.suppress(TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(t, 5)
