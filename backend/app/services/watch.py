"""Watch Together source validation and playback state.

The server never fetches, proxies, transcodes or decrypts media: it only
checks that a URL is an https link on an allowed host with a video file type,
and keeps a shared playback clock (status, position, rate, updatedAt) that
clients reconcile against.
"""

from __future__ import annotations

import ipaddress
import re
from typing import Any
from urllib.parse import urlsplit

from app.schemas.common import iso

VIDEO_EXTENSIONS = (".mp4", ".webm", ".ogv", ".ogg", ".m4v", ".mov")
MAX_URL = 2048
MAX_POSITION_SEC = 24 * 60 * 60
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def validate_source(url: str, title: str, allowed_hosts: list[str]) -> dict[str, Any] | None:
    """Return a clean WatchSource dict, or None if the URL isn't allowed."""
    if not isinstance(url, str) or len(url) > MAX_URL or _CONTROL.search(url):
        return None
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme != "https" or not host or parts.username or parts.password or port not in (None, 443):
        return None
    try:
        ipaddress.ip_address(host)
        return None  # IP literals bypass the host allowlist
    except ValueError:
        pass
    if not any(host == h or host.endswith("." + h) for h in allowed_hosts):
        return None
    path = parts.path.lower()
    if not path.endswith(VIDEO_EXTENSIONS):
        return None
    clean_title = _CONTROL.sub("", title or "").strip()[:120] or (parts.path.rsplit("/", 1)[-1][:120] or "Shared video")
    return {"kind": "url", "url": parts.geturl(), "title": clean_title}


def initial_state() -> dict[str, Any]:
    return {"source": None, "status": "idle", "positionSec": 0, "rate": 1, "updatedAt": iso(), "controlPolicy": "host"}


def apply_control(state: dict[str, Any], action: str, position: float) -> dict[str, Any]:
    pos = min(max(0.0, float(position)), MAX_POSITION_SEC)
    status = {"play": "playing", "pause": "paused"}.get(action, state["status"])
    if status == "idle":
        status = "paused"
    return {**state, "status": status, "positionSec": round(pos, 3), "updatedAt": iso()}
