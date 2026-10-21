"""Initial schema: users, blocks, reports, audit events, feature flags, game settings.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("display_name", sa.String(24), nullable=False),
        sa.Column("avatar_hue", sa.Integer(), nullable=False),
        sa.Column("age_band", sa.String(8), nullable=False),
        sa.Column("is_minor", sa.Boolean(), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("interests", sa.JSON(), nullable=False),
        sa.Column("accessibility", sa.JSON(), nullable=False),
        sa.Column("matching", sa.JSON(), nullable=False),
        sa.Column("consent_guidelines_at", TS, nullable=False),
        sa.Column("consent_interests", sa.Boolean(), nullable=False),
        sa.Column("privacy", sa.JSON(), nullable=False),
        sa.Column("roles", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("suspended_until", TS, nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.Column("last_seen_at", TS, nullable=False),
    )
    op.create_table(
        "blocks",
        sa.Column("blocker_id", sa.String(40), primary_key=True),
        sa.Column("blocked_id", sa.String(40), primary_key=True),
        sa.Column("blocked_display_name", sa.String(24), nullable=False),
        sa.Column("blocked_avatar_hue", sa.Integer(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
    )
    op.create_index("ix_blocks_blocked", "blocks", ["blocked_id"])
    op.create_table(
        "reports",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("reporter_id", sa.String(40), nullable=False),
        sa.Column("target_id", sa.String(40), nullable=False),
        sa.Column("target_display_name", sa.String(24), nullable=False),
        sa.Column("target_avatar_hue", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(24), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("room_id", sa.String(40), nullable=True),
        sa.Column("room_code", sa.String(8), nullable=True),
        sa.Column("message_id", sa.String(64), nullable=True),
        sa.Column("message_excerpt", sa.String(140), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("priority", sa.String(8), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("resolved_at", TS, nullable=True),
        sa.Column("resolved_by", sa.String(40), nullable=True),
        sa.Column("resolution_action", sa.String(24), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
    )
    op.create_index("ix_reports_reporter_id", "reports", ["reporter_id"])
    op.create_index("ix_reports_target_id", "reports", ["target_id"])
    op.create_index("ix_reports_status", "reports", ["status"])
    op.create_index("ix_reports_created_at", "reports", ["created_at"])
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("actor_id", sa.String(40), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("target_type", sa.String(24), nullable=False),
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("created_at", TS, nullable=False),
    )
    op.create_index("ix_audit_events_actor_id", "audit_events", ["actor_id"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])
    op.create_table(
        "feature_flags",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.Column("updated_by", sa.String(40), nullable=True),
    )
    op.create_table(
        "game_settings",
        sa.Column("game_id", sa.String(40), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("difficulties", sa.JSON(), nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.Column("updated_by", sa.String(40), nullable=True),
    )


def downgrade() -> None:
    for table in ("game_settings", "feature_flags", "audit_events", "reports", "blocks", "users"):
        op.drop_table(table)
