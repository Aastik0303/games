"""Solo sessions, rooms, matchmaking and realtime tickets."""

from __future__ import annotations

import json
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, Header, Path, Request, Response

from app.deps import client_ip, get_infra, get_services, require_principal
from app.errors import AppError
from app.infra import Infra
from app.redis import keys
from app.schemas.common import iso_ms
from app.schemas.games import AnswerResult, HintOut, RevealedClue, SoloAnswerIn, SoloSession, SoloStart
from app.schemas.rooms import CreateRoomInput, MatchCriteria, MatchStatus, MatchTicket, RealtimeTicket, Room
from app.services.container import Services
from app.services.sessions import Principal

router = APIRouter(prefix="/v1")


def id_param() -> Any:
    """A fresh Path() per parameter: FastAPI must not share one FieldInfo between params."""
    return Path(pattern=r"^[A-Za-z0-9_-]{1,64}$")


def code_param() -> Any:
    return Path(min_length=1, max_length=16)


# --- solo ---------------------------------------------------------------------------
@router.post("/solo/sessions", response_model=SoloSession, tags=["solo"], summary="Start a solo session")
async def solo_start(
    body: SoloStart, principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    await services.ratelimit.hit("solo_action", principal.id)
    return await services.solo.start(principal, body.game_id, body.difficulty)


@router.post(
    "/solo/sessions/{session_id}/answers",
    response_model=AnswerResult,
    tags=["solo"],
    summary="Submit an answer (send Idempotency-Key to make retries safe)",
)
async def solo_answer(
    body: SoloAnswerIn,
    session_id: str = id_param(),
    idempotency_key: str | None = Header(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
    principal: Principal = Depends(require_principal),
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    await services.ratelimit.hit("solo_action", principal.id)
    return await services.solo.submit(principal, session_id, body.answer, idempotency_key)


@router.post("/solo/sessions/{session_id}/hints", response_model=HintOut, tags=["solo"])
async def solo_hint(
    session_id: str = id_param(), principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    await services.ratelimit.hit("solo_action", principal.id)
    return await services.solo.hint(principal, session_id)


@router.post("/solo/sessions/{session_id}/clues/{clue_id}", response_model=RevealedClue, tags=["solo"])
async def solo_clue(
    session_id: str = id_param(),
    clue_id: str = id_param(),
    principal: Principal = Depends(require_principal),
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    await services.ratelimit.hit("solo_action", principal.id)
    return await services.solo.inspect_clue(principal, session_id, clue_id)


@router.post("/solo/sessions/{session_id}/advance", response_model=SoloSession, tags=["solo"])
async def solo_advance(
    session_id: str = id_param(), principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    return await services.solo.advance(principal, session_id)


# --- rooms ----------------------------------------------------------------------------
@router.post("/rooms", response_model=Room, tags=["rooms"], summary="Create a room (server generates the code)")
async def create_room(
    body: CreateRoomInput, principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    return await services.rooms.create(
        principal, body.activity.model_dump(by_alias=True, exclude_none=True), body.capacity, body.privacy
    )


@router.get("/rooms/{code}", response_model=Room, tags=["rooms"], summary="Look up a room by invite code")
async def get_room(
    request: Request,
    code: str = code_param(),
    principal: Principal = Depends(require_principal),
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    return await services.rooms.get_by_code(principal, code, client_ip(request))


@router.post("/rooms/{code}/join", response_model=Room, tags=["rooms"], summary="Join by code (idempotent)")
async def join_room(
    request: Request,
    code: str = code_param(),
    principal: Principal = Depends(require_principal),
    services: Services = Depends(get_services),
) -> dict[str, Any]:
    return await services.rooms.join(principal, code, client_ip(request))


@router.post(
    "/rooms/by-id/{room_id}/leave",
    status_code=204,
    tags=["rooms"],
    summary="Leave (the host role passes to the next participant)",
)
async def leave_room(
    room_id: str = id_param(), principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> Response:
    await services.rooms.leave(principal, room_id)
    return Response(status_code=204)


# --- matchmaking ------------------------------------------------------------------------
@router.post("/matchmaking/tickets", response_model=MatchTicket, tags=["matchmaking"])
async def enqueue(
    body: MatchCriteria, principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    return await services.matchmaking.enqueue(principal, body)


@router.get("/matchmaking/tickets/{ticket_id}", response_model=MatchStatus, tags=["matchmaking"])
async def ticket_status(
    ticket_id: str = id_param(), principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> dict[str, Any]:
    return await services.matchmaking.status(principal, ticket_id)


@router.delete("/matchmaking/tickets/{ticket_id}", status_code=204, tags=["matchmaking"])
async def cancel(
    ticket_id: str = id_param(), principal: Principal = Depends(require_principal), services: Services = Depends(get_services)
) -> Response:
    await services.matchmaking.cancel(principal, ticket_id)
    return Response(status_code=204)


# --- realtime ---------------------------------------------------------------------------
@router.post(
    "/realtime/tickets", response_model=RealtimeTicket, tags=["realtime"], summary="Single-use, short-lived WebSocket ticket"
)
async def realtime_ticket(principal: Principal = Depends(require_principal), infra: Infra = Depends(get_infra)) -> dict[str, Any]:
    await infra.services.ratelimit.hit("ws_ticket", principal.id)
    ticket = secrets.token_urlsafe(32)
    ttl = infra.settings.ws_ticket_ttl_sec
    await infra.redis.set(
        keys.ws_ticket(keys.token_hash(ticket)), json.dumps({"uid": principal.id, "sess": principal.token_digest}), ex=ttl
    )
    base = infra.settings.public_ws_base_url.rstrip("/")
    if not base.startswith(("ws://", "wss://")):
        raise AppError("server", "Realtime is misconfigured.")
    return {"url": f"{base}/v1/ws?ticket={ticket}", "expiresAt": iso_ms(time.time() * 1000 + ttl * 1000)}
