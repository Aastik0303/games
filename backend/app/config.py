"""Typed settings loaded from the environment (prefix ``PRISM_``).

Every value has a safe default for local development. ``validate_for_env``
refuses insecure combinations in production (wildcard CORS, insecure cookies,
in-memory Redis, SQLite).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Env = Literal["development", "test", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PRISM_", env_file=".env", extra="ignore")

    env: Env = "development"
    log_level: str = "INFO"

    # Storage. "memory://" runs an in-process fake Redis (development/test only, single worker).
    redis_url: str = "redis://localhost:6379/0"
    redis_timeout_sec: float = 2.0
    database_url: str = "sqlite+aiosqlite:///./prism-dev.db"
    # Create tables on startup (dev/test convenience). Production runs Alembic migrations instead.
    db_auto_create: bool = True

    # HTTP / browser security
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    cookie_name: str = "prism_session"
    cookie_secure: bool = False
    cookie_domain: str | None = None
    public_ws_base_url: str = "ws://localhost:8000"
    max_body_bytes: int = 64 * 1024
    # If set, GET /metrics requires "Authorization: Bearer <token>". Otherwise restrict it at the ingress.
    metrics_token: str | None = None
    trust_proxy_headers: bool = False

    # Lifetimes (seconds)
    session_ttl_sec: int = 2 * 60 * 60
    ws_ticket_ttl_sec: int = 30
    room_idle_ttl_sec: int = 6 * 60 * 60
    room_abandon_after_sec: int = 10 * 60
    presence_ttl_sec: int = 45
    presence_heartbeat_sec: int = 15
    reconnect_grace_sec: int = 120
    host_transfer_after_sec: int = 90
    solo_ttl_sec: int = 2 * 60 * 60
    match_ticket_ttl_sec: int = 120
    match_widen_after_sec: int = 30
    match_claim_lease_sec: int = 15
    idempotency_ttl_sec: int = 10 * 60

    # Realtime
    ws_max_message_bytes: int = 16 * 1024
    ws_commands_per_10s: int = 40

    # Watch Together: https hosts that may be loaded as a shared source.
    watch_allowed_hosts: list[str] = Field(
        default_factory=lambda: ["upload.wikimedia.org", "commons.wikimedia.org", "archive.org", "test-videos.co.uk"]
    )

    # Background workers (matcher, timers, sweeper). Disable to run an API-only instance.
    run_background_workers: bool = True

    @field_validator("cors_origins")
    @classmethod
    def _no_wildcard(cls, v: list[str]) -> list[str]:
        if any(o.strip() == "*" for o in v):
            raise ValueError("Wildcard CORS is not allowed: the API uses credentialed requests")
        return [o.rstrip("/") for o in v]

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    def validate_for_env(self) -> None:
        if not self.is_production:
            return
        problems = []
        if not self.cookie_secure:
            problems.append("PRISM_COOKIE_SECURE must be true in production")
        if self.redis_url.startswith("memory://"):
            problems.append("In-memory Redis is not allowed in production")
        if self.database_url.startswith("sqlite"):
            problems.append("Use PostgreSQL in production (PRISM_DATABASE_URL)")
        if self.db_auto_create:
            problems.append("Set PRISM_DB_AUTO_CREATE=false and run `alembic upgrade head` in production")
        if not self.public_ws_base_url.startswith("wss://"):
            problems.append("PRISM_PUBLIC_WS_BASE_URL must use wss:// in production")
        if problems:
            raise RuntimeError("; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
