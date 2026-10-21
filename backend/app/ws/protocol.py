"""Typed client -> server commands. Mirrors ``ClientCommandMap`` in frontend/src/lib/realtime/events.ts.

Every frame is validated twice: the envelope (id/type/payload), then the
payload against the model for its type. Unknown fields are rejected.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.schemas.games import TextAnswer
from app.schemas.rooms import RoomActivity, RoomPrivacy

REACTIONS = ("👏", "🔥", "😂", "🤯", "💜", "🎉")
ID_PATTERN = r"^[A-Za-z0-9_.:-]{1,64}$"


class Cmd(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Envelope(Cmd):
    id: str = Field(pattern=ID_PATTERN)
    type: str = Field(max_length=40)
    payload: dict[str, object]


class RoomRef(Cmd):
    room_id: str = Field(pattern=ID_PATTERN)


class Subscribe(RoomRef):
    last_seq: int | None = Field(default=None, ge=0)


class SetReady(RoomRef):
    ready: bool


class UpdateSettings(RoomRef):
    activity: RoomActivity | None = None
    capacity: int | None = Field(default=None, ge=2, le=8)
    privacy: RoomPrivacy | None = None


class Kick(RoomRef):
    user_id: str = Field(pattern=ID_PATTERN)


class ChatSend(RoomRef):
    client_msg_id: str = Field(pattern=ID_PATTERN)
    text: str = Field(max_length=2000)


class ReactionSend(RoomRef):
    reaction: Literal["👏", "🔥", "😂", "🤯", "💜", "🎉"]


class GameSubmit(RoomRef):
    round: int = Field(ge=1, le=100)
    answer: TextAnswer


class WatchSourceIn(Cmd):
    kind: Literal["url"] = "url"
    url: str = Field(max_length=2048)
    title: str = Field(default="", max_length=200)


class WatchSetSource(RoomRef):
    source: WatchSourceIn


class WatchControl(RoomRef):
    action: Literal["play", "pause", "seek"]
    position_sec: float = Field(ge=0, le=86_400)


class MatchWatch(Cmd):
    ticket_id: str = Field(pattern=ID_PATTERN)


COMMANDS: dict[str, type[Cmd]] = {
    "room.subscribe": Subscribe,
    "room.unsubscribe": RoomRef,
    "room.set_ready": SetReady,
    "room.update_settings": UpdateSettings,
    "room.kick": Kick,
    "room.start": RoomRef,
    "room.end_activity": RoomRef,
    "chat.send": ChatSend,
    "reaction.send": ReactionSend,
    "game.submit": GameSubmit,
    "watch.set_source": WatchSetSource,
    "watch.control": WatchControl,
    "matchmaking.watch": MatchWatch,
}

# Commands whose effects must not repeat if the client re-sends the same command id
# (e.g. after a reconnect). Their ack is cached in Redis for the idempotency window.
IDEMPOTENT_BY_ID = frozenset(
    {
        "room.update_settings",
        "room.kick",
        "room.start",
        "room.end_activity",
        "game.submit",
        "watch.set_source",
        "watch.control",
        "reaction.send",
    }
)

ACK_CODES = frozenset(
    {"forbidden", "not_found", "validation", "rate_limited", "conflict", "not_your_turn", "room_full", "server"}
)

# Close codes understood by the frontend (connection.ts).
CLOSE_AUTH = 4401  # ticket/session invalid: fetch a new ticket and retry
CLOSE_FORBIDDEN = 4403  # terminal
CLOSE_CONFLICT = 4409  # terminal
CLOSE_POLICY = 1008  # abuse (oversized/flooding): client backs off and retries
CLOSE_OVERLOADED = 1013
