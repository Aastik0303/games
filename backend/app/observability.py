"""Structured logging, request ids and a tiny metrics registry.

Logs are JSON lines. A redacting filter drops keys that could carry secrets or
private content (tokens, cookies, chat text, profile fields) even if a caller
passes them by mistake.

Metrics are kept in-process and exposed in Prometheus text format at
``/metrics``. Each worker reports its own counters; aggregate with Prometheus.
``set_error_hook`` lets a deployment forward exceptions to Sentry or similar.
"""

from __future__ import annotations

import contextlib
import json
import logging
import sys
import threading
import time
from bisect import bisect_left
from collections import defaultdict
from collections.abc import Callable
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

REDACTED_KEYS = frozenset(
    {
        "token",
        "ticket",
        "cookie",
        "authorization",
        "session",
        "password",
        "secret",
        "text",
        "message_text",
        "details",
        "note",
        "age_band",
        "ageBand",
        "interests",
        "profile",
    }
)

_STD_ATTRS = set(vars(logging.LogRecord("", 0, "", 0, "", (), None))) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        rid = request_id_var.get()
        if rid:
            payload["request_id"] = rid
        for key, value in record.__dict__.items():
            if key in _STD_ATTRS or key.startswith("_"):
                continue
            payload[key] = "[redacted]" if key in REDACTED_KEYS else value
        if record.exc_info and record.exc_info[0] is not None:
            payload["exc_type"] = record.exc_info[0].__name__
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # Uvicorn's access log prints full URLs, which include WebSocket tickets. Our
    # middleware logs requests without query strings instead.
    logging.getLogger("uvicorn.access").disabled = True


LabelKey = tuple[str, tuple[tuple[str, str], ...]]
_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120)


class Metrics:
    """Thread-safe counters, gauges and fixed-bucket histograms."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.counters: dict[LabelKey, float] = defaultdict(float)
        self.gauges: dict[LabelKey, float] = {}
        self.hist: dict[LabelKey, list[float]] = {}
        self.hist_sum: dict[LabelKey, float] = defaultdict(float)

    @staticmethod
    def _key(name: str, labels: dict[str, str]) -> LabelKey:
        return name, tuple(sorted((k, str(v)) for k, v in labels.items()))

    def inc(self, name: str, value: float = 1, **labels: str) -> None:
        with self._lock:
            self.counters[self._key(name, labels)] += value

    def set(self, name: str, value: float, **labels: str) -> None:
        with self._lock:
            self.gauges[self._key(name, labels)] = value

    def observe(self, name: str, seconds: float, **labels: str) -> None:
        key = self._key(name, labels)
        with self._lock:
            counts = self.hist.setdefault(key, [0.0] * (len(_BUCKETS) + 1))
            counts[bisect_left(_BUCKETS, seconds)] += 1
            self.hist_sum[key] += seconds

    def get(self, name: str, **labels: str) -> float:
        key = self._key(name, labels)
        return self.counters.get(key, self.gauges.get(key, 0.0))

    def render(self) -> str:
        def fmt(labels: tuple[tuple[str, str], ...], extra: str = "") -> str:
            parts = [f'{k}="{v}"' for k, v in labels] + ([extra] if extra else [])
            return "{" + ",".join(parts) + "}" if parts else ""

        lines: list[str] = []
        with self._lock:
            for (name, labels), v in sorted(self.counters.items()):
                lines.append(f"prism_{name}{fmt(labels)} {v}")
            for (name, labels), v in sorted(self.gauges.items()):
                lines.append(f"prism_{name}{fmt(labels)} {v}")
            for (name, labels), counts in sorted(self.hist.items()):
                running = 0.0
                for bound, c in zip((*_BUCKETS, float("inf")), counts, strict=True):
                    running += c
                    le = "+Inf" if bound == float("inf") else str(bound)
                    lines.append(f"prism_{name}_bucket{fmt(labels, f'le="{le}"')} {running}")
                lines.append(f"prism_{name}_count{fmt(labels)} {running}")
                lines.append(f"prism_{name}_sum{fmt(labels)} {self.hist_sum[(name, labels)]}")
        return "\n".join(lines) + "\n"


metrics = Metrics()

ErrorHook = Callable[[BaseException, dict[str, Any]], None]
_error_hook: ErrorHook | None = None


def set_error_hook(hook: ErrorHook | None) -> None:
    """Install a callback for unexpected exceptions (e.g. forward to Sentry)."""
    global _error_hook
    _error_hook = hook


def report_exception(exc: BaseException, **context: Any) -> None:
    logging.getLogger("prism").exception("background_error", extra={"error_type": type(exc).__name__, **context})
    if _error_hook:
        with contextlib.suppress(Exception):  # an error hook must never break the caller
            _error_hook(exc, context)


class Timer:
    def __init__(self, name: str, **labels: str) -> None:
        self.name, self.labels = name, labels

    def __enter__(self) -> Timer:
        self.start = time.perf_counter()
        return self

    def __exit__(self, *_: object) -> None:
        metrics.observe(self.name, time.perf_counter() - self.start, **self.labels)
