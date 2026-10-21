"""Durable records (PostgreSQL in production, SQLite for local dev and tests).

What lives here and why: guest profiles and consent (must survive a Redis
flush), blocks (so blocked users stay apart across sessions), reports and the
audit trail (incident review), catalog overrides and feature flags (operator
decisions). Live state (rooms, queues, games, presence) is Redis-only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(24))
    avatar_hue: Mapped[int] = mapped_column(Integer)
    age_band: Mapped[str] = mapped_column(String(8))
    is_minor: Mapped[bool] = mapped_column(Boolean)
    language: Mapped[str] = mapped_column(String(8))
    interests: Mapped[list[str]] = mapped_column(JSON, default=list)
    accessibility: Mapped[dict[str, Any]] = mapped_column(JSON)
    matching: Mapped[dict[str, Any]] = mapped_column(JSON)
    consent_guidelines_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consent_interests: Mapped[bool] = mapped_column(Boolean, default=False)
    privacy: Mapped[dict[str, Any]] = mapped_column(JSON)
    roles: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["player"])
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | suspended
    suspended_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Block(Base):
    __tablename__ = "blocks"

    blocker_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    blocked_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    blocked_display_name: Mapped[str] = mapped_column(String(24))
    blocked_avatar_hue: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_blocks_blocked", "blocked_id"),)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    reporter_id: Mapped[str] = mapped_column(String(40), index=True)
    target_id: Mapped[str] = mapped_column(String(40), index=True)
    target_display_name: Mapped[str] = mapped_column(String(24))
    target_avatar_hue: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(24))
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    room_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    room_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    message_excerpt: Mapped[str | None] = mapped_column(String(140), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    priority: Mapped[str] = mapped_column(String(8), default="normal")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    resolution_action: Mapped[str | None] = mapped_column(String(24), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class AuditEvent(Base):
    """Append-only record of privileged actions. Never updated or deleted by the app."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    actor_id: Mapped[str] = mapped_column(String(40), index=True)
    action: Mapped[str] = mapped_column(String(48))
    target_type: Mapped[str] = mapped_column(String(24))
    target_id: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class FeatureFlagRow(Base):
    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    description: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[str | None] = mapped_column(String(40), nullable=True)


class GameSetting(Base):
    """Operator overrides on top of the code-defined catalog."""

    __tablename__ = "game_settings"

    game_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
    difficulties: Mapped[list[str]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
