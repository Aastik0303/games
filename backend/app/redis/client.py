"""Redis connection factory.

``memory://<name>`` gives an in-process fake Redis (fakeredis, with Lua) so the
API can run without a Redis server in development and tests. Instances that
use the same name share one fake server, which lets tests run several app
instances ("workers") against shared state. It is refused in production by
``Settings.validate_for_env``.
"""

from __future__ import annotations

from typing import Any, cast

from redis.asyncio import Redis

from app.config import Settings

_FAKE_SERVERS: dict[str, Any] = {}


def fake_server(name: str) -> Any:
    import fakeredis  # dev dependency

    if name not in _FAKE_SERVERS:
        _FAKE_SERVERS[name] = fakeredis.FakeServer()
    return _FAKE_SERVERS[name]


def create_redis(settings: Settings) -> Redis:
    if settings.redis_url.startswith("memory://"):
        if settings.is_production:
            raise RuntimeError("memory:// Redis is not allowed in production")
        import fakeredis

        name = settings.redis_url.removeprefix("memory://") or "default"
        fake: Any = fakeredis.FakeAsyncRedis(server=fake_server(name), decode_responses=True)
        return cast(Redis, fake)
    client: Redis = Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_timeout=settings.redis_timeout_sec,
        socket_connect_timeout=settings.redis_timeout_sec,
        health_check_interval=15,
        retry_on_timeout=False,
    )
    return client
