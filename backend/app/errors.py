"""One error type for the whole app and the handlers that render it.

Every error response has the shape the frontend expects::

    {"error": {"code": "...", "message": "...", "fields": {...}?, "requestId": "..."}}

5xx responses never carry internal details; the request id lets support find
the server-side log line.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.observability import metrics, request_id_var

log = logging.getLogger("prism.errors")

STATUS_FOR_CODE: dict[str, int] = {
    "validation": 422,
    "unauthorized": 401,
    "session_expired": 401,
    "forbidden": 403,
    "not_found": 404,
    "conflict": 409,
    "room_full": 409,
    "not_your_turn": 409,
    "payload_too_large": 413,
    "rate_limited": 429,
    "unavailable": 503,
    "server": 500,
}


class AppError(Exception):
    """A predictable, user-safe failure. ``message`` may be shown to users for 4xx codes."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int | None = None,
        fields: dict[str, str] | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status or STATUS_FOR_CODE.get(code, 400)
        self.fields = fields
        self.retry_after = retry_after


def not_found(message: str = "Not found.") -> AppError:
    return AppError("not_found", message)


def forbidden(message: str = "You don't have permission to do that.") -> AppError:
    return AppError("forbidden", message)


def conflict(message: str) -> AppError:
    return AppError("conflict", message)


def validation(message: str, fields: dict[str, str] | None = None) -> AppError:
    return AppError("validation", message, fields=fields)


def error_body(code: str, message: str, fields: dict[str, str] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    rid = request_id_var.get()
    if rid:
        body["requestId"] = rid
    return {"error": body}


def _response(err: AppError) -> JSONResponse:
    headers = {"Retry-After": str(err.retry_after)} if err.retry_after else None
    return JSONResponse(error_body(err.code, err.message, err.fields), status_code=err.status, headers=headers)


def _field_name(loc: tuple[Any, ...]) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "header")]
    return ".".join(parts) or "body"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        metrics.inc("http_app_errors_total", code=exc.code)
        return _response(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields: dict[str, str] = {}
        for e in exc.errors():
            fields.setdefault(_field_name(tuple(e.get("loc", ()))), str(e.get("msg", "Invalid value"))[:200])
        return _response(AppError("validation", "Some fields are invalid.", fields=fields))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "not_found", 401: "unauthorized", 403: "forbidden"}.get(exc.status_code, "server")
        message = "Not found." if code == "not_found" else "Request failed."
        return _response(AppError(code, message, status=exc.status_code))

    @app.exception_handler(RedisError)
    async def _redis(_: Request, exc: RedisError) -> JSONResponse:
        metrics.inc("redis_errors_total", kind=type(exc).__name__)
        log.error("redis_unavailable", extra={"error_type": type(exc).__name__})
        return _response(AppError("unavailable", "The service is temporarily unavailable. Please retry.", retry_after=2))

    @app.exception_handler(SQLAlchemyError)
    async def _db(_: Request, exc: SQLAlchemyError) -> JSONResponse:
        metrics.inc("db_errors_total", kind=type(exc).__name__)
        log.error("database_error", extra={"error_type": type(exc).__name__})
        return _response(AppError("unavailable", "The service is temporarily unavailable. Please retry.", retry_after=2))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        metrics.inc("http_unhandled_errors_total")
        log.exception("unhandled_error", extra={"error_type": type(exc).__name__})
        return _response(AppError("server", "Something went wrong."))
