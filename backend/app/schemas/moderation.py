from __future__ import annotations

from typing import ClassVar, Literal

from pydantic import Field

from app.schemas.common import ActivityKind, CamelModel, StrictInput
from app.schemas.games import GameSummary
from app.schemas.profile import PublicUser
from app.schemas.rooms import RoomPhase

ReportReason = Literal["harassment", "hate", "sexual", "minor_safety", "spam", "personal_info", "cheating", "other"]
ReportStatus = Literal["open", "actioned", "dismissed"]
ModerationAction = Literal["dismiss", "warn", "remove_content", "suspend"]
HIGH_PRIORITY_REASONS = frozenset({"minor_safety", "personal_info"})


class ReportInput(StrictInput):
    omit_none: ClassVar[frozenset[str]] = frozenset({"room_id", "message_id", "details"})

    target_user_id: str = Field(max_length=40)
    room_id: str | None = Field(default=None, max_length=40)
    message_id: str | None = Field(default=None, max_length=64)
    reason: ReportReason
    details: str | None = Field(default=None, max_length=500)


class ReportCreated(CamelModel):
    report_id: str


class Resolution(CamelModel):
    action: ModerationAction
    note: str
    at: str


class ModerationReport(CamelModel):
    omit_none: ClassVar[frozenset[str]] = frozenset({"details", "room_code", "message_excerpt", "resolution"})

    id: str
    reason: ReportReason
    details: str | None = None
    target: PublicUser
    reporter_id: str
    room_code: str | None = None
    message_excerpt: str | None = None
    status: ReportStatus
    priority: Literal["normal", "high"]
    created_at: str
    resolution: Resolution | None = None


class ResolveInput(StrictInput):
    action: ModerationAction
    note: str = Field(default="", max_length=500)


FeatureFlagKey = Literal["multiplayer", "watchTogether", "screenShare", "reactions", "chat"]


class FeatureFlag(CamelModel):
    key: FeatureFlagKey
    description: str
    enabled: bool
    updated_at: str


class SetFlagInput(StrictInput):
    enabled: bool


class UpdateGameInput(StrictInput):
    enabled: bool | None = None
    difficulties: list[Literal["easy", "medium", "hard"]] | None = Field(default=None, max_length=3)


class RoomHealth(CamelModel):
    room_id: str
    code: str
    activity: ActivityKind
    participants: int
    capacity: int
    phase: RoomPhase
    age_seconds: int
    reconnects_last_hour: int
    issues: list[Literal["stale_host", "high_reconnects", "near_capacity"]]


class QueueHealth(CamelModel):
    game_id: str
    title: str
    waiting: int
    median_wait_seconds: float | None
    matches_last_hour: int


class OverviewMetrics(CamelModel):
    active_users: int
    active_rooms: int
    players_in_queue: int
    matches_last_hour: int
    open_reports: int
    reconnect_rate: float


class HourlyMatches(CamelModel):
    hour: str
    matches: int


class AdminOverview(CamelModel):
    generated_at: str
    metrics: OverviewMetrics
    hourly_matches: list[HourlyMatches]
    rooms: list[RoomHealth]
    queues: list[QueueHealth]


class TrendingGame(CamelModel):
    game_id: str
    title: str
    live_rooms: int


class CommunityPulse(CamelModel):
    activity: Literal["quiet", "steady", "busy"]
    players_online: int | None
    active_rooms: int | None
    trending: list[TrendingGame]
    generated_at: str


class AdminCloseRoom(StrictInput):
    reason: str = Field(min_length=3, max_length=300)


class AuditEventOut(CamelModel):
    omit_none: ClassVar[frozenset[str]] = frozenset({"reason"})

    id: str
    actor_id: str
    action: str
    target_type: str
    target_id: str
    reason: str | None = None
    created_at: str


__all__ = ["GameSummary"]
