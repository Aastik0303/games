from __future__ import annotations

import asyncio
import secrets
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text

from app import __version__
from app.deps import get_infra
from app.errors import AppError
from app.games.content import CONTENT_VERSION
from app.infra import Infra
from app.observability import metrics

router = APIRouter(tags=["health"])


@router.get("/v1/health/live", summary="Liveness: the process is up")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/v1/health/ready", summary="Readiness: Redis and the database are reachable")
async def ready(infra: Infra = Depends(get_infra)) -> JSONResponse:
    checks: dict[str, Any] = {}

    async def redis_check() -> None:
        await asyncio.wait_for(infra.redis.ping(), 2)

    async def db_check() -> None:
        async with infra.db() as db:
            await asyncio.wait_for(db.execute(text("SELECT 1")), 2)

    for name, fn in (("redis", redis_check), ("database", db_check)):
        try:
            await fn()
            checks[name] = "ok"
        except Exception as e:
            checks[name] = f"unavailable ({type(e).__name__})"
    ok = all(v == "ok" for v in checks.values())
    metrics.set("ready", 1 if ok else 0)
    return JSONResponse({"status": "ready" if ok else "not_ready", "checks": checks}, status_code=200 if ok else 503)


@router.get("/v1/version", summary="Build and content versions")
async def version(infra: Infra = Depends(get_infra)) -> dict[str, str]:
    return {"version": __version__, "contentVersion": CONTENT_VERSION, "env": infra.settings.env}


@router.get("/metrics", include_in_schema=False)
async def prometheus(request: Request, infra: Infra = Depends(get_infra)) -> PlainTextResponse:
    token = infra.settings.metrics_token
    if token:
        supplied = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not secrets.compare_digest(supplied, token):
            raise AppError("forbidden", "Metrics require a token.")
    return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")
