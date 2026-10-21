"""Guest profile, session cookie, privacy settings, flags and the public catalog."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Path, Request, Response

from app.deps import (
    clear_session_cookie,
    client_ip,
    get_infra,
    get_services,
    optional_principal,
    require_principal,
    set_session_cookie,
)
from app.infra import Infra
from app.schemas.games import GameSummary
from app.schemas.moderation import CommunityPulse
from app.schemas.profile import PrivacySettings, SessionCreate, SessionOut
from app.services.container import Services
from app.services.ratelimit import POLICIES
from app.services.sessions import Principal, effective_privacy

router = APIRouter(prefix="/v1", tags=["session"])


def id_param() -> Any:
    """A fresh Path() per parameter: FastAPI must not share one FieldInfo between params."""
    return Path(pattern=r"^[A-Za-z0-9_-]{1,64}$")


@router.get("/session", response_model=SessionOut, summary="Current session (401 when anonymous)")
async def get_session(
    principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    return services.sessions.to_session(principal)


@router.post("/session", response_model=SessionOut, summary="Create a guest profile and session (sets the cookie)")
async def create_session(
    body: SessionCreate,
    request: Request,
    response: Response,
    current: Principal | None = Depends(optional_principal),
    infra: Infra = Depends(get_infra),
) -> dict[str, Any]:
    services: Services = infra.services
    await services.ratelimit.hit("session_create", client_ip(request))
    token, principal = await services.sessions.create(body.profile, current)
    set_session_cookie(response, infra.settings, token)
    return services.sessions.to_session(principal)


@router.put("/session/profile", response_model=SessionOut, summary="Update the guest profile")
async def update_profile(
    body: SessionCreate, principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    principal = await services.sessions.update_profile(principal, body.profile)
    return services.sessions.to_session(principal)


@router.post("/session/refresh", response_model=SessionOut, summary="Extend the session")
async def refresh(
    principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    principal = await services.sessions.refresh(principal)
    return services.sessions.to_session(principal)


@router.delete("/session", status_code=204, summary="Sign out and delete the guest profile")
async def destroy(principal: Principal = Depends(require_principal), infra: Infra = Depends(get_infra)) -> Response:
    await infra.services.sessions.destroy(principal)
    out = Response(status_code=204)
    clear_session_cookie(out, infra.settings)
    return out


@router.get("/me/privacy", response_model=PrivacySettings)
async def get_privacy(principal: Principal = Depends(require_principal)) -> dict[str, Any]:
    return effective_privacy(principal.user)


@router.put("/me/privacy", response_model=PrivacySettings, summary="Update privacy (minors stay strict/matched-only)")
async def put_privacy(
    body: PrivacySettings, principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    return await services.sessions.set_privacy(principal, body)


@router.get("/me/rate-limits", summary="Remaining allowance for the caller's rate-limited actions")
async def rate_limits(
    request: Request, principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in POLICIES:
        subject = client_ip(request) if name.endswith("_ip") or name == "session_create" else principal.id
        out[name] = await services.ratelimit.status(name, subject)
    return out


@router.get("/config/flags", summary="Feature flags (public)")
async def flags(services: Services = Depends(get_services)) -> dict[str, bool]:
    return await services.flags.as_map()


@router.get("/community/pulse", response_model=CommunityPulse, summary="Coarse community activity (public)")
async def pulse(services: Services = Depends(get_services)) -> dict[str, Any]:
    return await services.admin.pulse()


@router.get("/games", response_model=list[GameSummary], tags=["games"], summary="Enabled games")
async def list_games(services: Services = Depends(get_services)) -> list[dict[str, Any]]:
    return await services.catalog.list_enabled()


@router.get("/games/{game_id}", response_model=GameSummary, tags=["games"])
async def get_game(game_id: str = id_param(), services: Services = Depends(get_services)) -> dict[str, Any]:
    summary, _ = await services.catalog.get_enabled(game_id)
    return summary
