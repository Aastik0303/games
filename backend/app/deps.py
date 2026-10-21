"""FastAPI dependencies: infrastructure, the caller's identity and role checks."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Depends, Request, Response

from app.config import Settings
from app.errors import AppError
from app.infra import Infra
from app.services.container import Services
from app.services.sessions import Principal


def get_infra(request: Request) -> Infra:
    infra: Infra = request.app.state.infra
    return infra


def get_services(infra: Infra = Depends(get_infra)) -> Services:
    services: Services = infra.services
    return services


def client_ip(request: Request) -> str:
    settings: Settings = request.app.state.infra.settings
    if settings.trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


async def optional_principal(request: Request, infra: Infra = Depends(get_infra)) -> Principal | None:
    token = request.cookies.get(infra.settings.cookie_name)
    principal: Principal | None = await infra.services.sessions.resolve(token)
    return principal


async def require_principal(request: Request, infra: Infra = Depends(get_infra)) -> Principal:
    token = request.cookies.get(infra.settings.cookie_name)
    principal: Principal | None = await infra.services.sessions.resolve(token)
    if principal is None:
        if token:
            raise AppError("session_expired", "Your session has ended.")
        raise AppError("unauthorized", "Sign in to continue.")
    return principal


def require_roles(*roles: str) -> Callable[..., Awaitable[Principal]]:
    """Authorization is decided here, server-side, on every request — never by the UI."""

    async def dep(principal: Principal = Depends(require_principal)) -> Principal:
        if not principal.roles.intersection(roles):
            raise AppError("forbidden", "You don't have permission to do that.")
        return principal

    return dep


require_admin = require_roles("admin")
require_staff = require_roles("admin", "moderator")


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.session_ttl_sec,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
        domain=settings.cookie_domain,
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.cookie_name,
        path="/",
        domain=settings.cookie_domain,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
