"""ASGI middleware: request ids + access log, body size cap, CSRF/origin checks, security headers.

Pure ASGI (not BaseHTTPMiddleware) so WebSockets and streaming are unaffected
and the body limit is enforced while the body is read, not after.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from app.errors import error_body
from app.observability import metrics, request_id_var

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

log = logging.getLogger("prism.http")
_SAFE_RID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
    (b"cache-control", b"no-store"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
]


def _header(scope: Scope, name: bytes) -> str | None:
    for k, v in scope.get("headers", []):
        if k == name:
            return str(v.decode("latin-1"))
    return None


async def _send_json(send: Send, status: int, body: dict[str, Any], rid: str | None) -> None:
    payload = json.dumps(body).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]
    if rid:
        headers.append((b"x-request-id", rid.encode()))
    await send({"type": "http.response.start", "status": status, "headers": headers + SECURITY_HEADERS})
    await send({"type": "http.response.body", "body": payload})


class RequestContextMiddleware:
    """Assigns a request id, logs one line per request (path only — never the query string)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        incoming = _header(scope, b"x-request-id")
        rid = incoming if incoming and _SAFE_RID.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(rid)
        start = time.perf_counter()
        status_holder = {"status": 0}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", rid.encode()))
                headers.extend(SECURITY_HEADERS)
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            if scope["type"] == "http":
                elapsed = time.perf_counter() - start
                route = scope.get("route")
                path_label = getattr(route, "path", "unmatched")
                metrics.inc("http_requests_total", method=scope["method"], route=path_label, status=str(status_holder["status"]))
                metrics.observe("http_request_seconds", elapsed, route=path_label)
                log.info(
                    "request",
                    extra={
                        "method": scope["method"],
                        "path": scope["path"],
                        "status": status_holder["status"],
                        "ms": round(elapsed * 1000, 1),
                    },
                )
            request_id_var.reset(token)


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = _header(scope, b"content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            await _send_json(send, 413, error_body("payload_too_large", "Request body is too large."), request_id_var.get())
            return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _BodyTooLarge:
            await _send_json(send, 413, error_body("payload_too_large", "Request body is too large."), request_id_var.get())


class _BodyTooLarge(Exception):
    pass


class CsrfMiddleware:
    """State-changing requests must carry ``X-Prism-Client: web`` and, if present, an allowed Origin.

    Browsers can't add custom headers to cross-site form posts, and a CORS
    preflight is required to add one from script — which our allowlist refuses
    for foreign origins. Together with SameSite=Lax cookies this blocks CSRF.
    """

    def __init__(self, app: ASGIApp, allowed_origins: list[str]) -> None:
        self.app = app
        self.allowed = set(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in UNSAFE_METHODS and scope["path"].startswith("/v1/"):
            origin = _header(scope, b"origin")
            if _header(scope, b"x-prism-client") != "web" or (origin is not None and origin not in self.allowed):
                metrics.inc("csrf_rejections_total")
                await _send_json(send, 403, error_body("forbidden", "Request blocked by CSRF protection."), request_id_var.get())
                return
        await self.app(scope, receive, send)
