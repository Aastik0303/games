"""Reports, blocks, and the admin/moderator API. Roles are checked on every request."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Path, Query, Response

from app.deps import get_services, require_admin, require_principal, require_staff
from app.schemas.games import GameSummary
from app.schemas.moderation import (
    AdminCloseRoom,
    AdminOverview,
    AuditEventOut,
    FeatureFlag,
    ModerationReport,
    ReportCreated,
    ReportInput,
    ResolveInput,
    SetFlagInput,
    UpdateGameInput,
)
from app.schemas.profile import PublicUser
from app.services.container import Services
from app.services.sessions import Principal

router = APIRouter(prefix="/v1")


def id_param() -> Any:
    """A fresh Path() per parameter: FastAPI must not share one FieldInfo between params."""
    return Path(pattern=r"^[A-Za-z0-9_-]{1,64}$")


def flag_param() -> Any:
    return Path(pattern=r"^[A-Za-z]{1,32}$")


@router.post("/reports", response_model=ReportCreated, tags=["moderation"])
async def report(
    body: ReportInput, principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, str]:
    return {"reportId": await services.moderation.report(principal, body)}


@router.put("/blocks/{user_id}", status_code=204, tags=["moderation"])
async def block(
    user_id: str = id_param(), principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> Response:
    await services.moderation.block(principal, user_id)
    return Response(status_code=204)


@router.delete("/blocks/{user_id}", status_code=204, tags=["moderation"])
async def unblock(
    user_id: str = id_param(), principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> Response:
    await services.moderation.unblock(principal, user_id)
    return Response(status_code=204)


@router.get("/blocks", response_model=list[PublicUser], tags=["moderation"])
async def blocked(
    principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> list[dict[str, Any]]:
    return await services.moderation.list_blocked(principal)


# --- admin & moderators --------------------------------------------------------------
admin = APIRouter(prefix="/v1/admin", tags=["admin"])


@admin.get("/overview", response_model=AdminOverview, summary="Aggregate health (admin, moderator)")
async def overview(_: Principal = Depends(require_staff), services: Services = Depends(get_services)) -> dict[str, Any]:
    return await services.admin.overview()


@admin.get("/games", response_model=list[GameSummary], summary="Full catalog incl. disabled (admin)")
async def admin_games(_: Principal = Depends(require_admin), services: Services = Depends(get_services)) -> list[dict[str, Any]]:
    return await services.catalog.list_all()


@admin.patch("/games/{game_id}", response_model=GameSummary, summary="Enable/disable a game or difficulties (admin)")
async def admin_update_game(
    body: UpdateGameInput,
    game_id: str = id_param(),
    actor: Principal = Depends(require_admin),
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    await services.ratelimit.hit("admin_write", actor.id)
    return await services.catalog.update(game_id, body.enabled, body.difficulties, actor.id)


@admin.get("/reports", response_model=list[ModerationReport], summary="Moderation queue (admin, moderator)")
async def admin_reports(
    status: Literal["open", "actioned"] = Query("open"),
    _: Principal = Depends(require_staff),
    services: Services = Depends(get_services),
) -> list[dict[str, Any]]:
    return await services.moderation.list_reports(status)


@admin.post(
    "/reports/{report_id}/resolution",
    response_model=ModerationReport,
    summary="Resolve a report; the action and note are audited (admin, moderator)",
)
async def admin_resolve(
    body: ResolveInput,
    report_id: str = id_param(),
    actor: Principal = Depends(require_staff),
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    await services.ratelimit.hit("admin_write", actor.id)
    return await services.moderation.resolve(actor, report_id, body.action, body.note)


@admin.get("/flags", response_model=list[FeatureFlag], summary="Feature flags (admin)")
async def admin_flags(_: Principal = Depends(require_admin), services: Services = Depends(get_services)) -> list[dict[str, Any]]:
    return await services.flags.list()


@admin.put("/flags/{key}", response_model=FeatureFlag, summary="Toggle a feature flag (admin)")
async def admin_set_flag(
    body: SetFlagInput,
    key: str = flag_param(),
    actor: Principal = Depends(require_admin),
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    await services.ratelimit.hit("admin_write", actor.id)
    return await services.flags.set(key, body.enabled, actor.id)


@admin.post("/rooms/{room_id}/close", status_code=204, summary="Close a room (admin, moderator)")
async def admin_close_room(
    body: AdminCloseRoom,
    room_id: str = id_param(),
    actor: Principal = Depends(require_staff),
    services: Services = Depends(get_services),
) -> Response:
    await services.ratelimit.hit("admin_write", actor.id)
    await services.admin.close_room(actor, room_id, body.reason)
    return Response(status_code=204)


@admin.post(
    "/rooms/{room_id}/participants/{user_id}/remove", status_code=204, summary="Remove someone from a room (admin, moderator)"
)
async def admin_remove(
    body: AdminCloseRoom,
    room_id: str = id_param(),
    user_id: str = id_param(),
    actor: Principal = Depends(require_staff),
    services: Services = Depends(get_services),
) -> Response:
    await services.ratelimit.hit("admin_write", actor.id)
    await services.admin.remove_participant(actor, room_id, user_id, body.reason)
    return Response(status_code=204)


@admin.get("/audit", response_model=list[AuditEventOut], summary="Privileged-action audit log (admin)")
async def admin_audit(
    limit: int = Query(100, ge=1, le=500), _: Principal = Depends(require_admin), services: Services = Depends(get_services)
) -> list[dict[str, Any]]:
    return await services.admin.audit_log(limit)
