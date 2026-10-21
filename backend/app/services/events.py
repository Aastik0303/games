"""Cross-worker event fanout over Redis Pub/Sub.

Room events get a per-room ``seq`` assigned and published in one Lua script,
so seq order equals publish order. Pub/Sub is at-most-once: an event can be
lost if a worker's subscriber connection drops. Clients recover because every
room event carries ``seq``; on a gap (or reconnect) the client re-subscribes
and receives an authoritative ``room.snapshot``. See docs/REALTIME.md.

Event types starting with ``_`` are internal control messages (e.g. revoke a
socket's room subscription). Workers act on them and never forward them.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.infra import Infra
from app.observability import metrics
from app.redis import keys
from app.schemas.common import iso

EVENT_VERSION = 1


def envelope(type_: str, payload: dict[str, Any], room_id: str | None = None) -> dict[str, Any]:
    ev: dict[str, Any] = {"id": str(uuid.uuid4()), "type": type_, "ts": iso(), "payload": payload, "v": EVENT_VERSION}
    if room_id:
        ev["roomId"] = room_id
    return ev


def _dumps(obj: dict[str, Any]) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


class EventBus:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra

    async def publish_room(self, room_id: str, type_: str, payload: dict[str, Any]) -> int:
        body = _dumps(envelope(type_, payload, room_id))
        ttl_ms = self.infra.settings.room_idle_ttl_sec * 1000
        seq = await self.infra.scripts.publish_seq(
            keys=[keys.room_seq(room_id)], args=[keys.room_channel(room_id), body[1:], ttl_ms]
        )
        metrics.inc("events_published_total", scope="room", type=type_)
        return int(seq)

    async def publish_user(self, user_id: str, type_: str, payload: dict[str, Any]) -> None:
        await self.infra.redis.publish(keys.user_channel(user_id), _dumps(envelope(type_, payload)))
        metrics.inc("events_published_total", scope="user", type=type_)

    async def current_seq(self, room_id: str) -> int:
        raw = await self.infra.redis.get(keys.room_seq(room_id))
        return int(raw) if raw else 0
