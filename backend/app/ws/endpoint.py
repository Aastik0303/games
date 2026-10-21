"""The /v1/ws endpoint: authenticate, validate every frame, dispatch commands, ack each exactly once."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, WebSocket
from pydantic import ValidationError
from redis.exceptions import RedisError

from app.errors import AppError
from app.infra import Infra
from app.observability import metrics, report_exception
from app.redis import keys
from app.ws import protocol as p
from app.ws.hub import Connection, Hub, event_frame

log = logging.getLogger("prism.ws")
router = APIRouter()
SESSION_RECHECK_SEC = 5.0
MAX_STRIKES = 20

FollowUp = Callable[[], Awaitable[None]] | None


def ack_frame(reply_to: str, ok: bool, data: Any = None, error: tuple[str, str] | None = None) -> str:
    payload: dict[str, Any] = {"replyTo": reply_to, "ok": ok}
    if ok and data is not None:
        payload["data"] = data
    if error:
        payload["error"] = {"code": error[0], "message": error[1]}
    return event_frame("ack", payload)


def _first_error(e: ValidationError) -> str:
    err = e.errors()[0]
    where = ".".join(str(x) for x in err.get("loc", ()))
    return f"{where}: {err.get('msg', 'invalid')}"[:200] if where else str(err.get("msg", "Invalid payload"))[:200]


@router.websocket("/v1/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    infra: Infra = ws.app.state.infra
    hub: Hub = ws.app.state.hub
    settings = infra.settings
    origin = ws.headers.get("origin")
    if origin is not None and origin.rstrip("/") not in settings.cors_origins:
        metrics.inc("ws_rejected_total", reason="origin")
        await ws.close(code=p.CLOSE_FORBIDDEN)  # before accept: handshake is refused
        return
    ip = ws.client.host if ws.client else "unknown"
    forwarded = ws.headers.get("x-forwarded-for")
    if settings.trust_proxy_headers and forwarded:
        ip = forwarded.split(",")[0].strip()[:64]
    try:
        await infra.services.ratelimit.hit("ws_connect_ip", ip)
        ticket = ws.query_params.get("ticket") or ""
        raw = await infra.redis.getdel(keys.ws_ticket(keys.token_hash(ticket))) if 0 < len(ticket) <= 128 else None
    except AppError:
        metrics.inc("ws_rejected_total", reason="rate_limited")
        await ws.close(code=p.CLOSE_OVERLOADED)
        return
    except RedisError:
        metrics.inc("ws_rejected_total", reason="redis")
        await ws.close(code=p.CLOSE_OVERLOADED)
        return
    await ws.accept()
    data = json.loads(raw) if raw else None
    principal = await infra.services.sessions.resolve_digest(data["sess"]) if data else None
    if principal is None or data is None or principal.id != data["uid"]:
        metrics.inc("ws_rejected_total", reason="auth")
        await ws.close(code=p.CLOSE_AUTH)
        return

    blocked = await infra.services.moderation.blocked_ids(principal.id)
    conn = Connection(ws, principal, blocked, settings.ws_commands_per_10s)
    hub.register(conn)
    metrics.inc("ws_connects_total")
    writer = asyncio.create_task(conn.writer())
    heart = asyncio.create_task(_heartbeat(infra, conn))
    try:
        while conn.close_code is None:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            text = msg.get("text")
            if text is None:
                conn.request_close(1003)  # binary frames are not part of the protocol
                break
            if len(text.encode()) > settings.ws_max_message_bytes:
                metrics.inc("ws_rejected_frames_total", reason="too_large")
                conn.request_close(1009)
                break
            await _handle(infra, hub, conn, text)
    except Exception as e:  # disconnects surface as various exception types
        if not isinstance(e, RuntimeError | ConnectionError):
            log.debug("ws_loop_ended", extra={"error_type": type(e).__name__})
    finally:
        heart.cancel()
        conn.request_close(conn.close_code or 1000)
        rooms = hub.unregister(conn)
        for room_id in rooms:
            with contextlib.suppress(Exception):
                await infra.services.rooms.disconnect(room_id, conn.user_id, conn.id)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(writer, 2)


async def _heartbeat(infra: Infra, conn: Connection) -> None:
    interval = infra.settings.presence_heartbeat_sec
    while conn.close_code is None:
        await asyncio.sleep(interval)
        try:
            if not await infra.services.sessions.is_live(conn.principal.token_digest):
                conn.request_close(p.CLOSE_AUTH)
                return
            for room_id in list(conn.rooms):
                await infra.services.rooms.heartbeat(room_id, conn.user_id, conn.id)
        except RedisError:
            metrics.inc("redis_errors_total", kind="ws_heartbeat")
        except Exception as e:
            report_exception(e, loop="ws-heartbeat")


async def _handle(infra: Infra, hub: Hub, conn: Connection, text: str) -> None:
    raw: Any = None
    try:
        raw = json.loads(text)
        env = p.Envelope.model_validate(raw)
    except (ValueError, ValidationError):
        metrics.inc("ws_rejected_frames_total", reason="malformed")
        conn.strikes += 1
        reply_to = raw.get("id") if isinstance(raw, dict) and isinstance(raw.get("id"), str) else None
        if reply_to and len(reply_to) <= 64:
            conn.push(ack_frame(reply_to, False, error=("validation", "Malformed command")))
        else:
            conn.push(event_frame("error", {"code": "validation", "message": "Malformed frame"}))
        if conn.strikes > MAX_STRIKES:
            conn.request_close(p.CLOSE_POLICY)
        return

    cached = conn.acks.get(env.id)
    if cached:
        conn.push(cached)  # duplicate command id on this socket: same answer, no second effect
        return
    if not conn.allow():
        conn.strikes += 1
        conn.push(ack_frame(env.id, False, error=("rate_limited", "Too many messages. Slow down.")))
        if conn.strikes > MAX_STRIKES:
            conn.request_close(p.CLOSE_POLICY)
        return

    if time.monotonic() - conn.session_checked > SESSION_RECHECK_SEC:
        try:
            if not await infra.services.sessions.is_live(conn.principal.token_digest):
                conn.request_close(p.CLOSE_AUTH)
                return
        except RedisError:
            conn.push(ack_frame(env.id, False, error=("server", "Temporarily unavailable. Please retry.")))
            return
        conn.session_checked = time.monotonic()

    model = p.COMMANDS.get(env.type)
    if model is None:
        conn.push(ack_frame(env.id, False, error=("validation", f"Unknown command {env.type[:40]}")))
        return
    try:
        payload = model.model_validate(env.payload)
    except ValidationError as e:
        metrics.inc("ws_rejected_frames_total", reason="payload")
        conn.push(ack_frame(env.id, False, error=("validation", _first_error(e))))
        return

    idem_key = None
    if env.type in p.IDEMPOTENT_BY_ID:
        room_id = getattr(payload, "room_id", "")
        idem_key = keys.room_idem(room_id, conn.user_id, f"cmd:{env.id}")
        try:
            if not await infra.redis.set(idem_key, "pending", nx=True, ex=infra.settings.idempotency_ttl_sec):
                prior = await infra.redis.get(idem_key)
                frame = (
                    prior
                    if prior and prior != "pending"
                    else ack_frame(env.id, False, error=("conflict", "This command is already being processed."))
                )
                conn.remember_ack(env.id, frame)
                conn.push(frame)
                return
        except RedisError:
            conn.push(ack_frame(env.id, False, error=("server", "Temporarily unavailable. Please retry.")))
            return

    follow: FollowUp = None
    with metrics_timer(env.type):
        try:
            data, follow = await _dispatch(infra, hub, conn, env.type, payload)
            frame = ack_frame(env.id, True, data)
        except AppError as e:
            if e.code in ("session_expired", "unauthorized"):
                conn.request_close(p.CLOSE_AUTH)
                return
            code = e.code if e.code in p.ACK_CODES else "server"
            message = e.message if code != "server" else "Something went wrong. Please retry."
            frame = ack_frame(env.id, False, error=(code, message))
        except RedisError:
            metrics.inc("redis_errors_total", kind="ws_command")
            frame = ack_frame(env.id, False, error=("server", "Temporarily unavailable. Please retry."))
            if idem_key:
                with contextlib.suppress(RedisError):
                    await infra.redis.delete(idem_key)
                idem_key = None
        except Exception as e:
            report_exception(e, command=env.type)
            frame = ack_frame(env.id, False, error=("server", "Something went wrong. Please retry."))
            if idem_key:
                with contextlib.suppress(Exception):
                    await infra.redis.delete(idem_key)
                idem_key = None
    conn.remember_ack(env.id, frame)
    if idem_key:
        with contextlib.suppress(RedisError):
            await infra.redis.set(idem_key, frame, ex=infra.settings.idempotency_ttl_sec)
    conn.push(frame)
    if follow:
        try:
            await follow()
        except AppError:
            pass
        except RedisError:
            metrics.inc("redis_errors_total", kind="ws_followup")
        except Exception as e:
            report_exception(e, command=env.type, stage="follow-up")


class metrics_timer:
    def __init__(self, command: str) -> None:
        self.command = command

    def __enter__(self) -> None:
        self.start = time.perf_counter()

    def __exit__(self, *_: object) -> None:
        metrics.observe("ws_command_seconds", time.perf_counter() - self.start, command=self.command)
        metrics.inc("ws_commands_total", command=self.command)


async def _dispatch(infra: Infra, hub: Hub, conn: Connection, type_: str, c: Any) -> tuple[Any, FollowUp]:
    s = infra.services
    pr = conn.principal
    if type_ == "room.subscribe":
        await s.rooms.require_member(pr, c.room_id)
        hub.subscribe(conn, c.room_id)

        async def follow() -> None:
            try:
                await s.rooms.connect(c.room_id, conn.user_id, conn.id)
                await hub.send_snapshot(conn, c.room_id)
            except AppError:
                hub.unsubscribe(conn, c.room_id)
                raise

        return None, follow
    if type_ == "room.unsubscribe":
        if c.room_id in conn.rooms:
            hub.unsubscribe(conn, c.room_id)
            await s.rooms.disconnect(c.room_id, conn.user_id, conn.id)
        return None, None
    if type_ == "room.set_ready":
        await s.rooms.set_ready(pr, c.room_id, c.ready)
    elif type_ == "room.update_settings":
        activity = c.activity.model_dump(by_alias=True, exclude_none=True) if c.activity else None
        await s.rooms.update_settings(pr, c.room_id, activity, c.capacity, c.privacy)
    elif type_ == "room.kick":
        await s.rooms.kick(pr, c.room_id, c.user_id)
    elif type_ == "room.start":
        await s.rooms.start(pr, c.room_id)
    elif type_ == "room.end_activity":
        await s.rooms.end_activity(pr, c.room_id)
    elif type_ == "chat.send":
        return await s.rooms.send_chat(pr, c.room_id, c.client_msg_id, c.text), None
    elif type_ == "reaction.send":
        await s.rooms.react(pr, c.room_id, c.reaction)
    elif type_ == "game.submit":
        return await s.live.submit(pr, c.room_id, c.round, c.answer.model_dump()), None
    elif type_ == "watch.set_source":
        await s.rooms.watch_set_source(pr, c.room_id, c.source.url, c.source.title)
    elif type_ == "watch.control":
        await s.rooms.watch_control(pr, c.room_id, c.action, c.position_sec)
    elif type_ == "matchmaking.watch":
        status = await s.matchmaking.status(pr, c.ticket_id)
        conn.tickets.add(c.ticket_id)

        async def send_status() -> None:
            if status["phase"] == "matched":
                conn.push(event_frame("matchmaking.matched", {"ticketId": c.ticket_id, "roomCode": status["roomCode"]}))
            else:
                conn.push(event_frame("matchmaking.status", {"ticketId": c.ticket_id, "phase": status["phase"]}))

        return None, send_status
    return None, None
