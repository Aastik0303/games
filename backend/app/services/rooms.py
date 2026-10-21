"""Rooms: creation, invite codes, membership, host rights, chat, presence and cleanup.

All room state lives in one versioned Redis document per room (room + private
meta + live game runtime + watch state), so every change is a single
compare-and-set: capacity checks, host changes and ready states can't race
across workers. Events are published only after the write succeeds.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import time
import uuid
from collections.abc import Callable
from typing import Any, TypeVar

from app.db.models import User
from app.errors import AppError
from app.infra import Infra, new_id
from app.observability import metrics
from app.redis import keys
from app.schemas.common import iso
from app.services.sessions import Principal, effective_privacy
from app.services.watch import initial_state

T = TypeVar("T")
log = logging.getLogger("prism.rooms")

ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 8
_CODE_RE = re.compile(rf"^[{ROOM_CODE_ALPHABET}]{{{ROOM_CODE_LENGTH}}}$")
CHAT_HISTORY = 200
CLOSED_ROOM_TTL_SEC = 600
SYSTEM_AUTHOR = {"id": "system", "displayName": "Prism", "avatarHue": 270, "isBot": False}
_LINK = re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE)

ROOM_GONE = AppError("not_found", "No room with that code. Codes are case-insensitive — check for typos.")
NOT_MEMBER = AppError("forbidden", "You're not in this room")


def normalize_code(raw: str) -> str:
    return re.sub(r"[\s-]", "", raw or "").upper()


def generate_code() -> str:
    return "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))


def age_group(is_minor: bool) -> str:
    return "minor" if is_minor else "adult"


def now_ms() -> int:
    return int(time.time() * 1000)


def participant(user: dict[str, Any], role: str, ready: bool) -> dict[str, Any]:
    return {"user": user, "role": role, "ready": ready, "connection": "online", "joinedAt": iso()}


def find(doc: dict[str, Any], user_id: str) -> dict[str, Any] | None:
    for p in doc["room"]["participants"]:
        if p["user"]["id"] == user_id:
            return dict(p)
    return None


def _find_live(doc: dict[str, Any], user_id: str) -> dict[str, Any] | None:
    for p in doc["room"]["participants"]:
        if p["user"]["id"] == user_id:
            return p  # type: ignore[no-any-return]
    return None


def bump(doc: dict[str, Any]) -> None:
    doc["room"]["version"] += 1
    doc["meta"]["lastActivity"] = now_ms()


def reset_ready(doc: dict[str, Any]) -> None:
    for p in doc["room"]["participants"]:
        p["ready"] = p["role"] == "host"


def pick_next_host(doc: dict[str, Any], exclude: str) -> dict[str, Any] | None:
    others = [p for p in doc["room"]["participants"] if p["user"]["id"] != exclude]
    online = [p for p in others if p["connection"] == "online"]
    pool = online or others
    return min(pool, key=lambda p: p["joinedAt"]) if pool else None


def set_host(doc: dict[str, Any], new_host_id: str) -> None:
    doc["room"]["hostId"] = new_host_id
    for p in doc["room"]["participants"]:
        p["role"] = "host" if p["user"]["id"] == new_host_id else "player"
        if p["role"] == "host":
            p["ready"] = True
    doc["meta"]["hostAwaySince"] = None


def member_info_from_user(user: User) -> dict[str, Any]:
    privacy = effective_privacy(user)
    return {
        "public": {"id": user.id, "displayName": user.display_name, "avatarHue": user.avatar_hue, "isBot": False},
        "strict": privacy["chatFilter"] == "strict" or user.is_minor,
        "extended": bool((user.accessibility or {}).get("extendedTimers")),
        "isMinor": user.is_minor,
    }


class RoomService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra

    # --- plumbing -------------------------------------------------------------
    @property
    def ttl_ms(self) -> int:
        return self.infra.settings.room_idle_ttl_sec * 1000

    async def load(self, room_id: str) -> dict[str, Any] | None:
        got = await self.infra.docs.get(keys.room_doc(room_id))
        return got[1] if got else None

    async def mutate(self, room_id: str, fn: Callable[[dict[str, Any]], T]) -> tuple[T, dict[str, Any]]:
        """Atomic read-modify-write of a room doc. Returns fn's result and the doc as written."""
        holder: dict[str, Any] = {}

        def wrapped(doc: dict[str, Any]) -> T:
            if doc["room"]["phase"] == "closed":
                raise AppError("not_found", "This room has closed.")
            result = fn(doc)
            holder["doc"] = doc
            return result

        result = await self.infra.docs.update(
            keys.room_doc(room_id), wrapped, self.ttl_ms, missing=AppError("not_found", "Room not found")
        )
        return result, holder["doc"]

    async def publish_room(self, doc: dict[str, Any]) -> None:
        await self.infra.services.events.publish_room(doc["room"]["id"], "room.updated", {"room": doc["room"]})

    async def _track_member_room(self, user_id: str, room_id: str) -> None:
        pipe = self.infra.redis.pipeline(transaction=False)
        pipe.sadd(keys.user_rooms(user_id), room_id)
        pipe.expire(keys.user_rooms(user_id), self.infra.settings.room_idle_ttl_sec)
        await pipe.execute()

    async def _touch_active(self, room_id: str) -> None:
        await self.infra.redis.zadd(keys.rooms_active(), {room_id: now_ms()})

    # --- creation ---------------------------------------------------------------
    async def validate_activity(self, activity: dict[str, Any], capacity: int) -> dict[str, Any]:
        """Returns the normalised activity. Raises on disabled features or unsupported settings."""
        flags = self.infra.services.flags
        if activity["kind"] == "watch":
            await flags.require("watchTogether", "Watch Together is currently disabled.")
            if not 2 <= capacity <= 8:
                raise AppError("validation", "Watch rooms hold 2–8 people.", fields={"capacity": "2–8"})
            return {"kind": "watch"}
        await flags.require("multiplayer", "Multiplayer is currently disabled.")
        summary, game = await self.infra.services.catalog.get_enabled(activity.get("gameId") or "")
        if "multiplayer" not in game.modes:
            raise AppError("validation", f"{game.title} is solo only for now.")
        if game.kind != activity["kind"]:
            raise AppError("validation", "That activity doesn't match the game.")
        if not game.min_players <= capacity <= game.max_players:
            raise AppError(
                "validation",
                f"{game.title} supports {game.min_players}–{game.max_players} players.",
                fields={"capacity": f"{game.min_players}–{game.max_players}"},
            )
        difficulty = activity.get("difficulty") or summary["difficulties"][0]
        if difficulty not in summary["difficulties"]:
            raise AppError("validation", "Difficulty not available.", fields={"difficulty": "Unavailable"})
        return {"kind": game.kind, "gameId": game.id, "difficulty": difficulty}

    async def _reserve_code(self, room_id: str) -> str:
        for _ in range(10):
            code = generate_code()
            if await self.infra.redis.set(keys.room_code(code), room_id, nx=True, ex=self.infra.settings.room_idle_ttl_sec):
                return code
        raise AppError("server", "Could not allocate a room code.")

    async def _build(
        self,
        room_id: str,
        host: dict[str, Any],
        members: list[dict[str, Any]],
        *,
        activity: dict[str, Any],
        capacity: int,
        privacy: str,
        origin: str,
        group: str,
        match_op: str | None = None,
    ) -> dict[str, Any]:
        code = await self._reserve_code(room_id)
        participants = [participant(host["public"], "host", True)]
        participants += [participant(m["public"], "player", False) for m in members]
        doc = {
            "room": {
                "id": room_id,
                "code": code,
                "hostId": host["public"]["id"],
                "activity": activity,
                "capacity": capacity,
                "privacy": privacy,
                "phase": "lobby",
                "participants": participants,
                "createdAt": iso(),
                "version": 1,
            },
            "meta": {
                "ageGroup": group,
                "origin": origin,
                "matchOp": match_op,
                "banned": [],
                "members": {m["public"]["id"]: {"strict": m["strict"], "extended": m["extended"]} for m in [host, *members]},
                "lastActivity": now_ms(),
                "reconnects": [],
                "hostAwaySince": None,
                "runId": None,
            },
            "game": None,
            "watch": None,
        }
        if not await self.infra.docs.create(keys.room_doc(room_id), doc, self.ttl_ms):
            await self.infra.redis.delete(keys.room_code(code))
            existing = await self.load(room_id)
            if existing is None:
                raise AppError("conflict", "Room creation raced; please retry.")
            return existing
        await self._touch_active(room_id)
        for m in [host, *members]:
            await self._track_member_room(m["public"]["id"], room_id)
        metrics.inc("rooms_created_total", origin=origin)
        return doc

    @staticmethod
    def member_info(principal: Principal) -> dict[str, Any]:
        return member_info_from_user(principal.user)

    async def create(self, principal: Principal, activity: dict[str, Any], capacity: int, privacy: str) -> dict[str, Any]:
        await self.infra.services.ratelimit.hit("room_create", principal.id)
        act = await self.validate_activity(activity, capacity)
        doc = await self._build(
            new_id("room"),
            self.member_info(principal),
            [],
            activity=act,
            capacity=capacity,
            privacy=privacy,
            origin="code",
            group=age_group(principal.user.is_minor),
        )
        await self.system_message(doc["room"]["id"], f"{principal.user.display_name} created the room.", broadcast=False)
        return dict(doc["room"])

    async def create_for_match(
        self, op_id: str, room_id: str, host: dict[str, Any], members: list[dict[str, Any]], activity: dict[str, Any], group: str
    ) -> dict[str, Any]:
        doc = await self._build(
            room_id,
            host,
            members,
            activity=activity,
            capacity=1 + len(members),
            privacy="private",
            origin="match",
            group=group,
            match_op=op_id,
        )
        if doc["meta"].get("matchOp") == op_id and doc["room"]["version"] == 1:
            await self.system_message(room_id, "You've been matched! Ready up when you're set.", broadcast=False)
        return doc

    # --- lookup / join / leave ------------------------------------------------
    async def _by_code(self, code: str) -> dict[str, Any] | None:
        c = normalize_code(code)
        if not _CODE_RE.match(c):
            return None
        room_id = await self.infra.redis.get(keys.room_code(c))
        if not room_id:
            return None
        doc = await self.load(room_id)
        if doc is None or doc["room"]["phase"] == "closed":
            return None
        return doc

    async def _miss(self, principal: Principal, ip: str) -> AppError:
        rl = self.infra.services.ratelimit
        metrics.inc("room_code_misses_total")
        await rl.hit("room_code_miss_user", principal.id)
        await rl.hit("room_code_miss_ip", ip)
        return ROOM_GONE

    async def _guard_guessing(self, principal: Principal, ip: str) -> None:
        rl = self.infra.services.ratelimit
        await rl.check("room_code_miss_user", principal.id)
        await rl.check("room_code_miss_ip", ip)

    async def get_by_code(self, principal: Principal, code: str, ip: str) -> dict[str, Any]:
        await self._guard_guessing(principal, ip)
        doc = await self._by_code(code)
        if doc is None:
            raise await self._miss(principal, ip)
        return dict(doc["room"])

    async def join(self, principal: Principal, code: str, ip: str) -> dict[str, Any]:
        await self.infra.services.ratelimit.hit("room_join", principal.id)
        await self._guard_guessing(principal, ip)
        doc = await self._by_code(code)
        if doc is None:
            raise await self._miss(principal, ip)
        uid = principal.id
        if find(doc, uid):
            return dict(doc["room"])  # idempotent for members
        await self._check_join_policy(principal, doc)
        info = self.member_info(principal)

        def fn(d: dict[str, Any]) -> bool:
            if find(d, uid):
                return False
            if uid in d["meta"]["banned"]:
                raise AppError("forbidden", "You were removed from this room.")
            if len(d["room"]["participants"]) >= d["room"]["capacity"]:
                raise AppError("room_full", "That room is full.")
            d["room"]["participants"].append(participant(info["public"], "player", False))
            d["meta"]["members"][uid] = {"strict": info["strict"], "extended": info["extended"]}
            bump(d)
            return True

        added, doc = await self.mutate(doc["room"]["id"], fn)
        if added:
            await self._track_member_room(uid, doc["room"]["id"])
            await self._touch_active(doc["room"]["id"])
            await self.publish_room(doc)
            await self.system_message(doc["room"]["id"], f"{principal.user.display_name} joined.")
        return dict(doc["room"])

    async def _check_join_policy(self, principal: Principal, doc: dict[str, Any]) -> None:
        meta = doc["meta"]
        if meta["ageGroup"] != age_group(principal.user.is_minor):
            raise AppError("forbidden", "You can't join this room.")
        if meta["origin"] != "match" and effective_privacy(principal.user)["invitePolicy"] == "matched_only":
            raise AppError("forbidden", "Your privacy settings only allow rooms from matchmaking.")
        ids = [p["user"]["id"] for p in doc["room"]["participants"]]
        if await self.infra.services.moderation.any_block_between(principal.id, ids):
            raise AppError("forbidden", "You can't join this room.")

    async def leave(self, principal: Principal, room_id: str) -> None:
        uid = principal.id

        def fn(d: dict[str, Any]) -> dict[str, Any] | None:
            if not find(d, uid):
                return None
            was_host = d["room"]["hostId"] == uid
            d["room"]["participants"] = [p for p in d["room"]["participants"] if p["user"]["id"] != uid]
            d["meta"]["members"].pop(uid, None)
            if d["game"]:
                d["game"]["turnOrder"] = [x for x in d["game"]["turnOrder"] if x != uid]
            new_host = None
            if was_host and d["room"]["participants"]:
                nh = pick_next_host(d, uid)
                if nh:
                    set_host(d, nh["user"]["id"])
                    new_host = nh["user"]["displayName"]
            bump(d)
            return {"empty": not d["room"]["participants"], "newHost": new_host}

        try:
            outcome, doc = await self.mutate(room_id, fn)
        except AppError as e:
            if e.code == "not_found":
                await self.infra.redis.srem(keys.user_rooms(uid), room_id)  # type: ignore[misc]
                return
            raise
        await self.infra.redis.srem(keys.user_rooms(uid), room_id)  # type: ignore[misc]
        stale = await self._presence_members(room_id, uid)
        if stale:
            await self.infra.redis.zrem(keys.room_presence(room_id), *stale)
        if outcome is None:
            return
        if outcome["empty"]:
            await self.close(room_id, "host_left")
            return
        await self.publish_room(doc)
        await self.system_message(room_id, f"{principal.user.display_name} left.")
        if outcome["newHost"]:
            await self.system_message(room_id, f"{outcome['newHost']} is now the host.")

    async def leave_all(self, principal: Principal) -> None:
        room_ids: set[str] = await self.infra.redis.smembers(keys.user_rooms(principal.id))  # type: ignore[misc]
        for rid in room_ids:
            try:
                await self.leave(principal, rid)
            except AppError:
                continue

    async def remove_member(self, room_id: str, user_id: str, reason: str, *, ban: bool) -> dict[str, Any]:
        """Host kick or moderator removal."""

        def fn(d: dict[str, Any]) -> dict[str, Any]:
            target = find(d, user_id)
            if not target:
                raise AppError("not_found", "That person already left")
            d["room"]["participants"] = [p for p in d["room"]["participants"] if p["user"]["id"] != user_id]
            d["meta"]["members"].pop(user_id, None)
            if ban and user_id not in d["meta"]["banned"]:
                d["meta"]["banned"].append(user_id)
            if d["game"]:
                d["game"]["turnOrder"] = [x for x in d["game"]["turnOrder"] if x != user_id]
            if d["room"]["hostId"] == user_id and d["room"]["participants"]:
                nh = pick_next_host(d, user_id)
                if nh:
                    set_host(d, nh["user"]["id"])
            bump(d)
            return target

        target, doc = await self.mutate(room_id, fn)
        await self.infra.redis.srem(keys.user_rooms(user_id), room_id)  # type: ignore[misc]
        await self.infra.services.events.publish_user(user_id, "room.removed", {"roomId": room_id, "reason": reason})
        if not doc["room"]["participants"]:
            await self.close(room_id, "moderation")
        else:
            await self.publish_room(doc)
        return target

    async def close(self, room_id: str, reason: str) -> None:
        def fn(d: dict[str, Any]) -> dict[str, Any]:
            if d["room"]["phase"] == "closed":
                raise AppError("conflict", "Already closed")
            d["room"]["phase"] = "closed"
            d["game"] = None
            d["meta"]["closedReason"] = reason
            bump(d)
            return d

        try:
            doc = await self.infra.docs.update(
                keys.room_doc(room_id), fn, CLOSED_ROOM_TTL_SEC * 1000, missing=AppError("not_found", "Room not found")
            )
        except AppError:
            await self.infra.redis.zrem(keys.rooms_active(), room_id)
            return
        code = doc["room"]["code"]
        await self.infra.services.events.publish_room(room_id, "room.closed", {"roomId": room_id, "reason": reason})
        pipe = self.infra.redis.pipeline(transaction=False)
        pipe.delete(keys.room_code(code))
        pipe.zrem(keys.rooms_active(), room_id)
        pipe.delete(keys.room_presence(room_id))
        pipe.expire(keys.room_chat(room_id), CLOSED_ROOM_TTL_SEC)
        for p in doc["room"]["participants"]:
            pipe.srem(keys.user_rooms(p["user"]["id"]), room_id)
        await pipe.execute()
        metrics.inc("rooms_closed_total", reason=reason)

    # --- snapshot & membership -------------------------------------------------
    async def require_member(self, principal: Principal, room_id: str) -> dict[str, Any]:
        doc = await self.load(room_id)
        if doc is None:
            raise AppError("not_found", "Room not found")
        if not find(doc, principal.id):
            raise NOT_MEMBER
        return doc

    async def snapshot(self, principal: Principal, room_id: str, blocked: set[str]) -> dict[str, Any]:
        # Read seq before state: the snapshot may be newer than its seq, never older,
        # and later events carry full state, so re-applying them is harmless.
        seq = await self.infra.services.events.current_seq(room_id)
        doc = await self.require_member(principal, room_id)
        chat = await self.chat_history(room_id)
        chat = [m for m in chat if m["author"]["id"] not in blocked]
        return {
            "seq": seq,
            "payload": {
                "room": doc["room"],
                "chat": chat,
                "game": doc["game"]["state"] if doc["game"] else None,
                "watch": doc["watch"],
            },
        }

    # --- chat -------------------------------------------------------------------
    async def chat_history(self, room_id: str) -> list[dict[str, Any]]:
        raw: list[str] = await self.infra.redis.lrange(keys.room_chat(room_id), 0, -1)  # type: ignore[misc]
        return [json.loads(r) for r in raw]

    async def _push_chat(self, room_id: str, message: dict[str, Any], broadcast: bool = True) -> None:
        pipe = self.infra.redis.pipeline(transaction=True)
        pipe.rpush(keys.room_chat(room_id), json.dumps(message, ensure_ascii=False))
        pipe.ltrim(keys.room_chat(room_id), -CHAT_HISTORY, -1)
        pipe.expire(keys.room_chat(room_id), self.infra.settings.room_idle_ttl_sec)
        await pipe.execute()
        if broadcast:
            await self.infra.services.events.publish_room(room_id, "chat.message", {"message": message})

    async def system_message(self, room_id: str, text: str, broadcast: bool = True) -> None:
        msg = {
            "id": f"sys_{uuid.uuid4().hex[:12]}",
            "roomId": room_id,
            "author": SYSTEM_AUTHOR,
            "text": text,
            "sentAt": iso(),
            "kind": "system",
        }
        await self._push_chat(room_id, msg, broadcast)

    async def send_chat(self, principal: Principal, room_id: str, client_msg_id: str, text: str) -> dict[str, Any]:
        await self.infra.services.flags.require("chat", "Chat is disabled")
        doc = await self.require_member(principal, room_id)
        idem = keys.room_idem(room_id, principal.id, f"chat:{client_msg_id}")
        existing = await self.infra.redis.get(idem)
        if existing:
            return {"messageId": existing}  # idempotent retry
        raw = (text or "").strip()
        if not 1 <= len(raw) <= 300:
            raise AppError("validation", "Messages must be 1–300 characters")
        await self.infra.services.ratelimit.hit("chat", principal.id)
        strict = doc["meta"]["ageGroup"] == "minor" or doc["meta"]["members"].get(principal.id, {}).get("strict", False)
        clean = _LINK.sub("[link removed]", raw) if strict else raw
        msg_id = new_id("msg", 6)
        if not await self.infra.redis.set(idem, msg_id, nx=True, ex=self.infra.settings.idempotency_ttl_sec):
            return {"messageId": await self.infra.redis.get(idem)}
        message = {
            "id": msg_id,
            "clientMsgId": client_msg_id,
            "roomId": room_id,
            "author": principal.public(),
            "text": clean,
            "sentAt": iso(),
            "kind": "user",
        }
        await self._push_chat(room_id, message)
        metrics.inc("chat_messages_total")
        return {"messageId": msg_id}

    async def find_message(self, room_id: str, message_id: str) -> dict[str, Any] | None:
        for m in await self.chat_history(room_id):
            if m["id"] == message_id:
                return m
        return None

    async def remove_message(self, room_id: str, message_id: str) -> bool:
        key = keys.room_chat(room_id)
        for raw in await self.infra.redis.lrange(key, 0, -1):  # type: ignore[misc]
            if json.loads(raw)["id"] == message_id:
                await self.infra.redis.lrem(key, 1, raw)  # type: ignore[misc]
                await self.infra.services.events.publish_room(
                    room_id, "chat.removed", {"roomId": room_id, "messageId": message_id}
                )
                return True
        return False

    # --- presence ---------------------------------------------------------------
    async def _presence_members(self, room_id: str, user_id: str) -> list[str]:
        members: list[str] = await self.infra.redis.zrange(keys.room_presence(room_id), 0, -1)
        return [m for m in members if m.split("|", 1)[0] == user_id]

    async def heartbeat(self, room_id: str, user_id: str, conn_id: str) -> None:
        exp = now_ms() + self.infra.settings.presence_ttl_sec * 1000
        pipe = self.infra.redis.pipeline(transaction=False)
        pipe.zadd(keys.room_presence(room_id), {f"{user_id}|{conn_id}": exp})
        pipe.pexpire(keys.room_presence(room_id), self.ttl_ms)
        pipe.zadd(keys.online_users(), {user_id: now_ms()})
        await pipe.execute()

    async def set_connection(self, room_id: str, user_id: str, state: str) -> None:
        def fn(d: dict[str, Any]) -> bool:
            p = _find_live(d, user_id)
            if not p or p["connection"] == state:
                return False
            if state == "online" and p["connection"] == "reconnecting":
                d["meta"]["reconnects"] = [t for t in d["meta"]["reconnects"] if t > now_ms() - 3_600_000][-200:]
                d["meta"]["reconnects"].append(now_ms())
                metrics.inc("ws_reconnects_total")
            p["connection"] = state
            m = d["meta"]["members"].setdefault(user_id, {})
            m["disconnectedAt"] = None if state == "online" else m.get("disconnectedAt") or now_ms()
            if d["room"]["hostId"] == user_id:
                d["meta"]["hostAwaySince"] = None if state == "online" else d["meta"]["hostAwaySince"] or now_ms()
            d["meta"]["lastActivity"] = now_ms()
            return True

        try:
            changed, _ = await self.mutate(room_id, fn)
        except AppError:
            return
        if changed:
            await self.infra.services.events.publish_room(
                room_id, "presence.changed", {"roomId": room_id, "userId": user_id, "connection": state}
            )

    async def connect(self, room_id: str, user_id: str, conn_id: str) -> None:
        await self.heartbeat(room_id, user_id, conn_id)
        await self.set_connection(room_id, user_id, "online")

    async def disconnect(self, room_id: str, user_id: str, conn_id: str) -> None:
        await self.infra.redis.zrem(keys.room_presence(room_id), f"{user_id}|{conn_id}")
        if not await self._presence_members(room_id, user_id):
            await self.set_connection(room_id, user_id, "reconnecting")

    async def sweep(self) -> None:
        """Stale presence -> reconnecting -> offline; host transfer; abandoned room cleanup."""
        s = self.infra.settings
        now = now_ms()
        room_ids: list[str] = await self.infra.redis.zrange(keys.rooms_active(), 0, -1)
        for room_id in room_ids:
            try:
                await self._sweep_room(
                    room_id, now, s.reconnect_grace_sec * 1000, s.host_transfer_after_sec * 1000, s.room_abandon_after_sec * 1000
                )
            except AppError:
                continue

    async def _sweep_room(self, room_id: str, now: int, grace: int, host_after: int, abandon_after: int) -> None:
        doc = await self.load(room_id)
        if doc is None:
            await self.infra.redis.zrem(keys.rooms_active(), room_id)
            return
        if doc["room"]["phase"] == "closed":
            await self.infra.redis.zrem(keys.rooms_active(), room_id)
            return
        await self.infra.redis.zremrangebyscore(keys.room_presence(room_id), "-inf", now)
        live_users = {m.split("|", 1)[0] for m in await self.infra.redis.zrange(keys.room_presence(room_id), 0, -1)}

        def fn(d: dict[str, Any]) -> dict[str, Any]:
            changes: dict[str, Any] = {"presence": [], "newHost": None, "abandon": False}
            for p in d["room"]["participants"]:
                uid = p["user"]["id"]
                if uid in live_users or p["user"].get("isBot"):
                    continue
                m = d["meta"]["members"].setdefault(uid, {})
                if p["connection"] == "online":
                    p["connection"], m["disconnectedAt"] = "reconnecting", now
                    changes["presence"].append((uid, "reconnecting"))
                elif p["connection"] == "reconnecting" and now - (m.get("disconnectedAt") or now) > grace:
                    p["connection"] = "offline"
                    changes["presence"].append((uid, "offline"))
            host = _find_live(d, d["room"]["hostId"])
            if host and host["connection"] != "online":
                d["meta"]["hostAwaySince"] = d["meta"]["hostAwaySince"] or now
                if now - d["meta"]["hostAwaySince"] > host_after:
                    nh = pick_next_host(d, host["user"]["id"])
                    if nh and nh["connection"] == "online":
                        set_host(d, nh["user"]["id"])
                        changes["newHost"] = nh["user"]["displayName"]
            if all(p["connection"] != "online" for p in d["room"]["participants"]):
                last_seen = max(
                    [
                        (d["meta"]["members"].get(p["user"]["id"]) or {}).get("disconnectedAt") or 0
                        for p in d["room"]["participants"]
                    ]
                    or [0]
                )
                if now - max(last_seen, d["meta"]["lastActivity"]) > abandon_after:
                    changes["abandon"] = True
            if changes["presence"] or changes["newHost"]:
                d["room"]["version"] += 1
            return changes

        changes, doc = await self.mutate(room_id, fn)
        if changes["abandon"]:
            await self.close(room_id, "expired")
            return
        for uid, state in changes["presence"]:
            await self.infra.services.events.publish_room(
                room_id, "presence.changed", {"roomId": room_id, "userId": uid, "connection": state}
            )
        if changes["newHost"]:
            await self.publish_room(doc)
            await self.system_message(room_id, f"{changes['newHost']} is now the host.")

    # --- host commands (called from the WebSocket handler) --------------------------
    async def set_ready(self, principal: Principal, room_id: str, ready: bool) -> None:
        def fn(d: dict[str, Any]) -> None:
            p = _find_live(d, principal.id)
            if not p:
                raise NOT_MEMBER
            if d["room"]["phase"] != "lobby":
                raise AppError("conflict", "You can only change ready status in the lobby")
            p["ready"] = bool(ready) or p["role"] == "host"
            bump(d)

        _, doc = await self.mutate(room_id, fn)
        await self.publish_room(doc)

    async def update_settings(
        self, principal: Principal, room_id: str, activity: dict[str, Any] | None, capacity: int | None, privacy: str | None
    ) -> None:
        doc = await self.require_member(principal, room_id)
        if doc["room"]["hostId"] != principal.id:
            raise AppError("forbidden", "Only the host can change room settings")
        new_capacity = capacity if capacity is not None else doc["room"]["capacity"]
        new_activity = activity if activity is not None else doc["room"]["activity"]
        try:
            act = await self.validate_activity(new_activity, new_capacity)
        except AppError as e:
            raise AppError("validation", e.message) from e

        def fn(d: dict[str, Any]) -> None:
            if d["room"]["hostId"] != principal.id:
                raise AppError("forbidden", "Only the host can change room settings")
            if d["room"]["phase"] != "lobby":
                raise AppError("conflict", "Return to the lobby to change settings")
            if new_capacity < len(d["room"]["participants"]):
                raise AppError("validation", "Capacity can't be below the current number of people")
            if act != d["room"]["activity"]:
                d["room"]["activity"] = act
                reset_ready(d)
            d["room"]["capacity"] = new_capacity
            if privacy is not None:
                d["room"]["privacy"] = privacy
            bump(d)

        _, doc = await self.mutate(room_id, fn)
        await self.publish_room(doc)

    async def kick(self, principal: Principal, room_id: str, user_id: str) -> None:
        doc = await self.require_member(principal, room_id)
        if doc["room"]["hostId"] != principal.id:
            raise AppError("forbidden", "Only the host can remove people")
        if user_id == principal.id:
            raise AppError("validation", "You can't remove yourself")
        target = await self.remove_member(room_id, user_id, "kicked", ban=True)
        await self.system_message(room_id, f"{target['user']['displayName']} was removed by the host.")

    async def start(self, principal: Principal, room_id: str) -> None:
        doc = await self.require_member(principal, room_id)
        if doc["room"]["hostId"] != principal.id:
            raise AppError("forbidden", "Only the host can start")
        if doc["room"]["activity"]["kind"] == "watch":
            await self.infra.services.flags.require("watchTogether", "Watch Together is currently disabled.")

            def fn(d: dict[str, Any]) -> None:
                if d["room"]["hostId"] != principal.id:
                    raise AppError("forbidden", "Only the host can start")
                if d["room"]["phase"] != "lobby":
                    raise AppError("conflict", "An activity is already running")
                d["room"]["phase"] = "watching"
                d["watch"] = d["watch"] or initial_state()
                bump(d)

            _, doc = await self.mutate(room_id, fn)
            await self.publish_room(doc)
            await self.infra.services.events.publish_room(room_id, "watch.state", {"roomId": room_id, "state": doc["watch"]})
            await self.system_message(room_id, "Watch Together started.")
            return
        await self.infra.services.live.start(principal, room_id)

    async def end_activity(self, principal: Principal, room_id: str) -> None:
        def fn(d: dict[str, Any]) -> None:
            if not find(d, principal.id):
                raise NOT_MEMBER
            if d["room"]["hostId"] != principal.id:
                raise AppError("forbidden", "Only the host can end the activity")
            d["room"]["phase"] = "lobby"
            d["game"] = None
            d["meta"]["runId"] = None
            if d["watch"]:
                d["watch"] = {**d["watch"], "status": "paused", "updatedAt": iso()}
            reset_ready(d)
            bump(d)

        _, doc = await self.mutate(room_id, fn)
        await self.publish_room(doc)
        await self.system_message(room_id, "Back to the lobby.")

    async def react(self, principal: Principal, room_id: str, reaction: str) -> None:
        await self.infra.services.flags.require("reactions", "Reactions are disabled")
        await self.require_member(principal, room_id)
        await self.infra.services.ratelimit.hit("reaction", principal.id)
        await self.infra.services.events.publish_room(
            room_id, "reaction", {"roomId": room_id, "userId": principal.id, "reaction": reaction}
        )

    async def watch_set_source(self, principal: Principal, room_id: str, url: str, title: str) -> None:
        from app.services.watch import validate_source

        source = validate_source(url, title, self.infra.settings.watch_allowed_hosts)
        if source is None:
            raise AppError("validation", "Use an https:// link to a video file on an approved site that you're allowed to share")
        await self._watch_update(
            principal, room_id, lambda w: {**w, "source": source, "status": "paused", "positionSec": 0, "updatedAt": iso()}
        )
        await self.system_message(room_id, f"{principal.user.display_name} loaded “{source['title']}”.")

    async def watch_control(self, principal: Principal, room_id: str, action: str, position: float) -> None:
        from app.services.watch import apply_control

        await self.infra.services.ratelimit.hit("watch_control", principal.id)

        def change(w: dict[str, Any]) -> dict[str, Any]:
            if not w["source"]:
                raise AppError("conflict", "Choose something to watch first")
            return apply_control(w, action, position)

        await self._watch_update(principal, room_id, change)

    async def _watch_update(self, principal: Principal, room_id: str, change: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
        await self.infra.services.flags.require("watchTogether", "Watch Together is currently disabled.")

        def fn(d: dict[str, Any]) -> None:
            if not find(d, principal.id):
                raise NOT_MEMBER
            if d["room"]["phase"] != "watching" or not d["watch"]:
                raise AppError("conflict", "Watch Together isn't running")
            if d["watch"]["controlPolicy"] == "host" and d["room"]["hostId"] != principal.id:
                raise AppError("forbidden", "Only the host controls playback")
            d["watch"] = change(d["watch"])
            d["meta"]["lastActivity"] = now_ms()

        _, doc = await self.mutate(room_id, fn)
        await self.infra.services.events.publish_room(room_id, "watch.state", {"roomId": room_id, "state": doc["watch"]})
