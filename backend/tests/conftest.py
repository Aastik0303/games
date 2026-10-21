"""Test harness.

Each test gets a fresh in-process fake Redis (fakeredis with Lua) and a fresh
SQLite file. ``make_app`` can build several app instances against the same
Redis and database to exercise multi-worker behaviour. Background loops are
off; tests drive the matcher, timers and sweeper explicitly so they're
deterministic.
"""

from __future__ import annotations

import os
import time
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.redis import keys
from app.redis.client import fake_server

ORIGIN = "http://localhost:3000"
HEADERS = {"X-Prism-Client": "web", "Origin": ORIGIN}


def profile(name: str = "Player One", age_band: str = "25_34", **over: Any) -> dict[str, Any]:
    p = {
        "displayName": name,
        "ageBand": age_band,
        "language": "en",
        "interests": [],
        "accessibility": {"captions": False, "screenReaderOptimized": False, "colorSafePalette": False, "extendedTimers": False},
        "matching": {"preferSharedInterests": False, "preferSameLanguage": True, "playStyle": "any"},
        "consent": {"guidelinesAccepted": True, "useInterestsForMatching": False},
    }
    p.update(over)
    return p


class Api:
    """A TestClient bound to one browser (one cookie jar)."""

    def __init__(self, app: Any, client: TestClient) -> None:
        self.app = app
        self.client = client
        self.cookies: dict[str, str] = {}

    def another(self) -> Api:
        """A second browser talking to the same app instance."""
        return Api(self.app, self.client)

    def _send(self, method: str, path: str, **kw: Any) -> Any:
        self.client.cookies.clear()
        for k, v in self.cookies.items():
            self.client.cookies.set(k, v)
        headers = {**HEADERS, **kw.pop("headers", {})}
        r = self.client.request(method, path, headers=headers, **kw)
        self.cookies = {c.name: c.value for c in self.client.cookies.jar}
        return r

    @property
    def infra(self) -> Any:
        return self.app.state.infra

    def run(self, fn: Callable[..., Any], *args: Any) -> Any:
        """Run an async callable on the app's event loop."""
        return self.client.portal.call(fn, *args)  # type: ignore[union-attr]

    def get(self, path: str, **kw: Any) -> Any:
        return self._send("GET", path, **kw)

    def post(self, path: str, json: Any = None, **kw: Any) -> Any:
        return self._send("POST", path, json=json, **kw)

    def put(self, path: str, json: Any = None, **kw: Any) -> Any:
        return self._send("PUT", path, json=json, **kw)

    def patch(self, path: str, json: Any = None, **kw: Any) -> Any:
        return self._send("PATCH", path, json=json, **kw)

    def delete(self, path: str, **kw: Any) -> Any:
        return self._send("DELETE", path, **kw)

    def reset_limits(self) -> None:
        async def go() -> None:
            r = self.infra.redis
            found = await r.keys(keys.rate("*", "*"))
            if found:
                await r.delete(*found)

        self.run(go)

    def signup(self, name: str = "Player One", age_band: str = "25_34", **over: Any) -> dict[str, Any]:
        self.reset_limits()  # every test browser shares one IP
        r = self.post("/v1/session", {"profile": profile(name, age_band, **over)})
        assert r.status_code == 200, r.text
        return dict(r.json())

    def ws_url(self) -> str:
        r = self.post("/v1/realtime/tickets")
        assert r.status_code == 200, r.text
        url: str = r.json()["url"]
        return url.replace("ws://localhost:8000", "")

    def connect(self) -> Any:
        return self.client.websocket_connect(self.ws_url(), headers={"Origin": ORIGIN})

    def grant(self, *roles: str) -> None:
        from app.db.models import User

        uid = self.get("/v1/session").json()["user"]["id"]

        async def go() -> None:
            async with self.infra.db() as db:
                user = await db.get(User, uid)
                user.roles = ["player", *roles]
                await db.commit()

        self.run(go)

    def fire_timers(self) -> int:
        """Make every scheduled timer due now and run them."""

        async def go() -> int:
            r = self.infra.redis
            jobs = await r.zrange(keys.timers_due(), 0, -1)
            if jobs:
                await r.zadd(keys.timers_due(), dict.fromkeys(jobs, 0))
            return int(await self.infra.services.timers.run_due())

        return int(self.run(go))


# Set PRISM_TEST_REDIS_URL (e.g. redis://localhost:6379/15) to run the suite against a real Redis.
# That database is flushed before every test. Outage-simulation tests need the in-process fake and are skipped.
REAL_REDIS = os.environ.get("PRISM_TEST_REDIS_URL")
fake_redis_only = pytest.mark.skipif(bool(REAL_REDIS), reason="simulates outages with the in-process fake Redis")


def _flush_real_redis() -> None:
    import redis as sync_redis

    client = sync_redis.Redis.from_url(REAL_REDIS or "")
    client.flushdb()
    client.close()


@pytest.fixture
def make_app(tmp_path: Path) -> Iterator[Callable[..., Api]]:
    redis_name = f"t{uuid.uuid4().hex[:8]}"
    redis_url = REAL_REDIS or f"memory://{redis_name}"
    if REAL_REDIS:
        _flush_real_redis()
    db_url = f"sqlite+aiosqlite:///{(tmp_path / 'prism.db').as_posix()}"
    stack: list[TestClient] = []

    def factory(**settings_over: Any) -> Api:
        """Start a new app instance (a "worker") sharing this test's Redis and database."""
        settings = Settings(
            env="test",
            redis_url=redis_url,
            database_url=db_url,
            run_background_workers=False,
            cors_origins=[ORIGIN],
            public_ws_base_url="ws://localhost:8000",
            **settings_over,
        )
        app = create_app(settings)
        client = TestClient(app, base_url="http://testserver")
        client.__enter__()
        stack.append(client)
        return Api(app, client)

    yield factory
    for c in reversed(stack):
        c.__exit__(None, None, None)
    if not REAL_REDIS:
        fake_server(redis_name).connected = True


@pytest.fixture
def api(make_app: Callable[..., Api]) -> Api:
    return make_app()


def wait_for(ws: Any, type_: str, limit: int = 50) -> dict[str, Any]:
    """Read frames until one of ``type_`` arrives."""
    for _ in range(limit):
        frame = ws.receive_json()
        if frame["type"] == type_:
            return dict(frame)
    raise AssertionError(f"no {type_} frame")


def command(ws: Any, type_: str, payload: dict[str, Any], cmd_id: str | None = None) -> dict[str, Any]:
    """Send a command and return its ack (skipping unrelated events)."""
    cid = cmd_id or uuid.uuid4().hex
    ws.send_json({"id": cid, "type": type_, "payload": payload})
    for _ in range(50):
        frame = ws.receive_json()
        if frame["type"] == "ack" and frame["payload"]["replyTo"] == cid:
            return dict(frame["payload"])
    raise AssertionError("no ack")


def now_ms() -> int:
    return int(time.time() * 1000)
