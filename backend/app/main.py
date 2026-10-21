"""Application factory and lifespan (startup checks, background workers, graceful shutdown)."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import health, moderation, play, session
from app.config import Settings, get_settings
from app.db.models import Base
from app.db.session import create_engine, create_sessionmaker
from app.errors import install_error_handlers
from app.games.registry import validate_content
from app.infra import Infra
from app.middleware import BodyLimitMiddleware, CsrfMiddleware, RequestContextMiddleware
from app.observability import configure_logging
from app.redis.client import create_redis
from app.services.container import BackgroundWorkers, build_services
from app.ws import endpoint as ws_endpoint
from app.ws.hub import Hub

log = logging.getLogger("prism")

DESCRIPTION = """
Prism API. JSON over HTTPS with an HttpOnly session cookie, plus one multiplexed
WebSocket (`/v1/ws`, see docs/REALTIME.md).

Errors always look like `{"error": {"code", "message", "fields"?, "requestId"?}}`.
State-changing requests must send `X-Prism-Client: web`.
"""


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.validate_for_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(settings.log_level)
        problems = validate_content()
        if problems:
            raise RuntimeError(f"Invalid game content: {problems}")
        redis = create_redis(settings)
        engine = create_engine(settings)
        if settings.db_auto_create:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        infra = Infra(settings=settings, redis=redis, engine=engine, db=create_sessionmaker(engine))
        build_services(infra)
        try:
            await infra.services.flags.ensure_defaults()
        except Exception:
            log.exception("flag_defaults_failed")
        hub = Hub(infra)
        workers = BackgroundWorkers(infra)
        app.state.infra, app.state.hub, app.state.workers = infra, hub, workers
        hub.start()
        if settings.run_background_workers:
            workers.start()
        log.info("startup", extra={"version": __version__, "env": settings.env})
        try:
            yield
        finally:
            log.info("shutdown")
            await hub.shutdown()
            await workers.shutdown()
            await redis.aclose()
            await engine.dispose()

    app = FastAPI(
        title="Prism API",
        version=__version__,
        description=DESCRIPTION,
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
    )
    install_error_handlers(app)
    for router in (health.router, session.router, play.router, moderation.router, moderation.admin, ws_endpoint.router):
        app.include_router(router)

    # Order: outermost first at runtime is the last added.
    app.add_middleware(CsrfMiddleware, allowed_origins=settings.cors_origins)
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.max_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Prism-Client", "Idempotency-Key", "X-Request-ID"],
        expose_headers=["Retry-After", "X-Request-ID"],
        max_age=600,
    )
    app.add_middleware(RequestContextMiddleware)
    return app


def app_factory() -> FastAPI:
    """Entry point for uvicorn: ``uvicorn app.main:app_factory --factory``."""
    return create_app()
