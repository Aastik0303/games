"""Every Redis key Prism uses, in one place. See docs/REDIS_KEYS.md.

Conventions:
- Prefix ``prism:`` and a schema version (``v1``) so a breaking change can
  coexist with old keys during a rollout.
- ``{...}`` is a Redis Cluster hash tag. Keys that a Lua script or transaction
  touches together share a tag so they land in one slot.
- Secrets (session tokens, socket tickets) are stored only as SHA-256 hashes.
"""

from __future__ import annotations

import hashlib

P = "prism:v1"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- sessions & auth ---------------------------------------------------------
def session(token_digest: str) -> str:
    return f"{P}:sess:{token_digest}"


def user_sessions(user_id: str) -> str:
    """SET of session token digests for a user (to revoke on suspend/sign-out)."""
    return f"{P}:user:{user_id}:sessions"


def ws_ticket(ticket_digest: str) -> str:
    return f"{P}:wst:{ticket_digest}"


# --- rooms (one hash tag per room) -------------------------------------------
def _room(room_id: str) -> str:
    return f"{P}:{{room:{room_id}}}"


def room_doc(room_id: str) -> str:
    """HASH {v: version, d: json} holding room, live game runtime and watch state."""
    return f"{_room(room_id)}:doc"


def room_seq(room_id: str) -> str:
    return f"{_room(room_id)}:seq"


def room_chat(room_id: str) -> str:
    return f"{_room(room_id)}:chat"


def room_presence(room_id: str) -> str:
    """ZSET member ``user_id|conn_id`` scored by heartbeat expiry (ms)."""
    return f"{_room(room_id)}:presence"


def room_idem(room_id: str, user_id: str, key: str) -> str:
    return f"{_room(room_id)}:idem:{user_id}:{key}"


def room_code(code: str) -> str:
    return f"{P}:roomcode:{code}"


def rooms_active() -> str:
    """ZSET room_id scored by last activity (ms). Drives admin overview and cleanup."""
    return f"{P}:rooms:active"


def user_rooms(user_id: str) -> str:
    return f"{P}:user:{user_id}:rooms"


# --- events ------------------------------------------------------------------
EVENT_PATTERN = f"{P}:ev:*"


def room_channel(room_id: str) -> str:
    return f"{P}:ev:room:{room_id}"


def user_channel(user_id: str) -> str:
    return f"{P}:ev:user:{user_id}"


# --- solo ---------------------------------------------------------------------
def solo_doc(session_id: str) -> str:
    return f"{P}:solo:{session_id}"


# --- matchmaking (one hash tag per segment) ----------------------------------
def mm_segment_tag(segment: str) -> str:
    return f"{P}:mm:{{seg:{segment}}}"


def mm_queue(segment: str) -> str:
    """ZSET ticket_id scored by enqueue time (ms): oldest first."""
    return f"{mm_segment_tag(segment)}:q"


def mm_ticket(segment: str, ticket_id: str) -> str:
    """HASH: user, criteria, enq, status(queued|claimed|matched|cancelled|expired), op, room_code."""
    return f"{mm_segment_tag(segment)}:t:{ticket_id}"


def mm_claims(segment: str) -> str:
    """HASH op_id -> {"tickets": [...], "at": ms}: in-progress match claims, for crash recovery."""
    return f"{mm_segment_tag(segment)}:claims"


def mm_ticket_index(ticket_id: str) -> str:
    return f"{P}:mm:ticket:{ticket_id}"


def mm_user_ticket(user_id: str) -> str:
    return f"{P}:mm:user:{user_id}"


def mm_segments() -> str:
    return f"{P}:mm:segments"


def mm_op(op_id: str) -> str:
    """Match operation id -> room id. SET NX makes room creation for a match idempotent."""
    return f"{P}:mm:op:{op_id}"


# --- timers -------------------------------------------------------------------
def timers_due() -> str:
    return f"{P}:{{timers}}:due"


def timers_inflight() -> str:
    return f"{P}:{{timers}}:inflight"


# --- misc ---------------------------------------------------------------------
def rate(bucket: str, subject: str) -> str:
    return f"{P}:rl:{bucket}:{subject}"


def idem(user_id: str, scope: str, key: str) -> str:
    return f"{P}:idem:{user_id}:{scope}:{key}"


def online_users() -> str:
    """ZSET user_id scored by last seen (ms)."""
    return f"{P}:online"


def worker_lock(name: str) -> str:
    return f"{P}:lock:{name}"


def metric_hourly(name: str, hour: str) -> str:
    return f"{P}:m:{name}:{hour}"


def metric_samples(name: str, label: str) -> str:
    return f"{P}:m:{name}:{label}:samples"
