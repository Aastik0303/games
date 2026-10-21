from __future__ import annotations

from typing import ClassVar, Literal

from pydantic import Field, model_validator

from app.schemas.common import ActivityKind, CamelModel, Difficulty, StrictInput
from app.schemas.profile import Interest, Language, PublicUser

RoomPrivacy = Literal["private", "open"]
RoomPhase = Literal["lobby", "playing", "watching", "closed"]
ConnectionState = Literal["online", "reconnecting", "offline"]


class RoomActivity(CamelModel):
    omit_none: ClassVar[frozenset[str]] = frozenset({"game_id", "difficulty"})

    kind: ActivityKind
    game_id: str | None = Field(default=None, max_length=40)
    difficulty: Difficulty | None = None

    @model_validator(mode="after")
    def _game_needs_id(self) -> RoomActivity:
        if self.kind != "watch" and not self.game_id:
            raise ValueError("Choose a game.")
        return self


class Participant(CamelModel):
    user: PublicUser
    role: Literal["host", "player"]
    ready: bool
    connection: ConnectionState
    joined_at: str


class Room(CamelModel):
    id: str
    code: str
    host_id: str
    activity: RoomActivity
    capacity: int
    privacy: RoomPrivacy
    phase: RoomPhase
    participants: list[Participant]
    created_at: str
    version: int


class CreateRoomInput(StrictInput):
    activity: RoomActivity
    capacity: int = Field(ge=2, le=8)
    privacy: RoomPrivacy = "private"


class MatchCriteria(StrictInput):
    game_id: str = Field(max_length=40)
    group_size: int = Field(ge=2, le=4)
    difficulty: Difficulty
    language: Language
    interests: list[Interest] = Field(default_factory=list, max_length=5)


class MatchTicket(CamelModel):
    ticket_id: str
    criteria: MatchCriteria
    created_at: str


class MatchStatus(CamelModel):
    omit_none: ClassVar[frozenset[str]] = frozenset({"room_code"})

    ticket_id: str
    phase: Literal["queued", "searching", "widening", "matched", "expired", "cancelled"]
    room_code: str | None = None


class RealtimeTicket(CamelModel):
    url: str
    expires_at: str
