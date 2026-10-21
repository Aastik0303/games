"""Per-process registry of WebSocket connections and the Redis event listener.

Each worker holds one pattern subscription (``prism:v1:ev:*``) and forwards
events to its local sockets: room events to sockets subscribed to that room,
user events to that user's sockets. Each socket has a bounded send queue; a
client that can't keep up is disconnected (it reconnects and resyncs from a
snapshot) instead of slowing everyone else down.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections import OrderedDict, deque
from typing import Any

from redis.exceptions import RedisError
from starlette.websockets import WebSocket

from app.infra import Infra
from app.observability import metrics, report_exception
from app.redis import keys
from app.schemas.common import iso
from app.services.sessions import Principal

log = logging.getLogger("prism.ws")
SEND_QUEUE = 256
PING_IDLE_SEC = 15
ACK_CACHE = 256
ROOM_PREFIX = keys.room_channel("")
USER_PREFIX = keys.user_channel("")


class Connection:
    def __init__(self, ws: WebSocket, principal: Principal, blocked: set[str], rate_per_10s: int) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.ws = ws
        self.principal = principal
        self.blocked = blocked
        self.rooms: set[str] = set()
        self.pending: dict[str, list[tuple[int, str]]] = {}
        self.tickets: set[str] = set()
        self.queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=SEND_QUEUE)
        self.acks: OrderedDict[str, str] = OrderedDict()
        self.window: deque[float] = deque()
        self.rate_per_10s = rate_per_10s
        self.strikes = 0
        self.close_code: int | None = None
        self.session_checked = time.monotonic()

    @property
    def user_id(self) -> str:
        return self.principal.id

    def push(self, frame: str) -> None:
        if self.close_code is not None:
            return
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            metrics.inc("ws_slow_consumer_closes_total")
            self.request_close(1013)

    def request_close(self, code: int) -> None:
        if self.close_code is None:
            self.close_code = code
            with contextlib.suppress(asyncio.QueueFull):
                self.queue.put_nowait(None)

    def allow(self) -> bool:
        now = time.monotonic()
        while self.window and now - self.window[0] > 10:
            self.window.popleft()
        if len(self.window) >= self.rate_per_10s:
            return False
        self.window.append(now)
        return True

    def remember_ack(self, cmd_id: str, frame: str) -> None:
        self.acks[cmd_id] = frame
        while len(self.acks) > ACK_CACHE:
            self.acks.popitem(last=False)

    async def writer(self) -> None:
        try:
            while True:
                frame = await self.queue.get()
                if frame is None:
                    break
                await self.ws.send_text(frame)
                metrics.inc("ws_frames_sent_total")
        except Exception:  # noqa: S110 - the socket is gone; the reader loop cleans up
            pass
        finally:
            with contextlib.suppress(Exception):
                await self.ws.close(code=self.close_code or 1000)


def event_frame(type_: str, payload: dict[str, Any], room_id: str | None = None, seq: int | None = None) -> str:
    ev: dict[str, Any] = {"id": str(uuid.uuid4()), "type": type_, "ts": iso(), "payload": payload, "v": 1}
    if room_id:
        ev["roomId"] = room_id
    if seq is not None:
        ev["seq"] = seq
    return json.dumps(ev, separators=(",", ":"), ensure_ascii=False)


class Hub:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra
        self.by_room: dict[str, set[Connection]] = {}
        self.by_user: dict[str, set[Connection]] = {}
        self.stop = asyncio.Event()
        self.task: asyncio.Task[None] | None = None
        self.connected = asyncio.Event()
        self._tasks: set[asyncio.Task[None]] = set()

    # --- registry -------------------------------------------------------------
    def register(self, conn: Connection) -> None:
        self.by_user.setdefault(conn.user_id, set()).add(conn)
        metrics.set("ws_connections", sum(len(v) for v in self.by_user.values()))

    def unregister(self, conn: Connection) -> list[str]:
        rooms = list(conn.rooms)
        for room_id in rooms:
            self.unsubscribe(conn, room_id)
        users = self.by_user.get(conn.user_id)
        if users:
            users.discard(conn)
            if not users:
                del self.by_user[conn.user_id]
        metrics.set("ws_connections", sum(len(v) for v in self.by_user.values()))
        return rooms

    def subscribe(self, conn: Connection, room_id: str) -> None:
        conn.rooms.add(room_id)
        conn.pending[room_id] = []  # buffer until the snapshot is sent
        self.by_room.setdefault(room_id, set()).add(conn)

    def unsubscribe(self, conn: Connection, room_id: str) -> None:
        conn.rooms.discard(room_id)
        conn.pending.pop(room_id, None)
        subs = self.by_room.get(room_id)
        if subs:
            subs.discard(conn)
            if not subs:
                del self.by_room[room_id]

    @staticmethod
    def flush_pending(conn: Connection, room_id: str, snapshot_seq: int) -> None:
        for seq, frame in conn.pending.pop(room_id, []):
            if seq > snapshot_seq:
                conn.push(frame)

    async def send_snapshot(self, conn: Connection, room_id: str) -> None:
        conn.pending.setdefault(room_id, [])
        snap = await self.infra.services.rooms.snapshot(conn.principal, room_id, conn.blocked)
        conn.push(event_frame("room.snapshot", snap["payload"], room_id, snap["seq"]))
        self.flush_pending(conn, room_id, snap["seq"])

    # --- fanout ----------------------------------------------------------------
    def dispatch(self, channel: str, data: str) -> None:
        try:
            ev = json.loads(data)
        except ValueError:
            return
        metrics.inc("ws_events_received_total")
        if channel.startswith(ROOM_PREFIX):
            self._room_event(channel[len(ROOM_PREFIX) :], ev, data)
        elif channel.startswith(USER_PREFIX):
            self._user_event(channel[len(USER_PREFIX) :], ev, data)

    def _room_event(self, room_id: str, ev: dict[str, Any], frame: str) -> None:
        type_ = ev.get("type")
        for conn in list(self.by_room.get(room_id, ())):
            if type_ == "chat.message":
                author = ev.get("payload", {}).get("message", {}).get("author", {}).get("id")
                if author in conn.blocked:
                    continue
            if room_id in conn.pending:
                conn.pending[room_id].append((int(ev.get("seq", 0)), frame))
                continue
            conn.push(frame)
            if type_ == "room.closed":
                self.unsubscribe(conn, room_id)

    def _user_event(self, user_id: str, ev: dict[str, Any], frame: str) -> None:
        type_ = str(ev.get("type", ""))
        for conn in list(self.by_user.get(user_id, ())):
            if type_ == "_session.revoked":
                conn.request_close(4401)
            elif type_ == "_blocks.changed":
                task = asyncio.create_task(self._reload_blocks(conn))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
            elif type_.startswith("_"):
                continue
            else:
                if type_ == "room.removed":
                    self.unsubscribe(conn, str(ev.get("payload", {}).get("roomId", "")))
                conn.push(frame)

    async def _reload_blocks(self, conn: Connection) -> None:
        with contextlib.suppress(Exception):
            conn.blocked = await self.infra.services.moderation.blocked_ids(conn.user_id)

    # --- listener ------------------------------------------------------------------
    def start(self) -> None:
        self.task = asyncio.create_task(self._listen(), name="ws-listener")

    async def _listen(self) -> None:
        backoff = 0.25
        dropped = False
        while not self.stop.is_set():
            pubsub = self.infra.redis.pubsub()
            try:
                await pubsub.psubscribe(keys.EVENT_PATTERN)
                self.connected.set()
                if dropped:
                    metrics.inc("ws_listener_reconnects_total")
                    await self._resync_all()
                    dropped = False
                backoff = 0.25
                last_seen = time.monotonic()
                while not self.stop.is_set():
                    msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if msg:
                        last_seen = time.monotonic()
                        if msg.get("type") == "pmessage":
                            self.dispatch(str(msg["channel"]), str(msg["data"]))
                    elif time.monotonic() - last_seen > PING_IDLE_SEC:
                        # Detect half-open connections: a dead socket raises here and we resubscribe.
                        await pubsub.ping()
                        last_seen = time.monotonic()
            except (RedisError, OSError):
                self.connected.clear()
                dropped = True
                metrics.inc("redis_errors_total", kind="ws_listener")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 10)
            except Exception as e:
                report_exception(e, loop="ws-listener")
                dropped = True
                await asyncio.sleep(1)
            finally:
                with contextlib.suppress(Exception):
                    await pubsub.aclose()  # type: ignore[no-untyped-call]

    async def _resync_all(self) -> None:
        """Events may have been lost while disconnected: push fresh snapshots."""
        for room_id, conns in list(self.by_room.items()):
            for conn in list(conns):
                with contextlib.suppress(Exception):
                    await self.send_snapshot(conn, room_id)

    async def shutdown(self) -> None:
        self.stop.set()
        for conns in list(self.by_user.values()):
            for conn in list(conns):
                conn.request_close(1012)  # service restart: clients reconnect to another instance
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.task
