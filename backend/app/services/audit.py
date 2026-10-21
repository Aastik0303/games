from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditEvent
from app.infra import new_id
from app.observability import request_id_var
from app.schemas.common import utcnow

log = logging.getLogger("prism.audit")


def record(
    db: AsyncSession,
    *,
    actor_id: str,
    action: str,
    target_type: str,
    target_id: str,
    reason: str | None = None,
    data: dict[str, Any] | None = None,
) -> AuditEvent:
    """Add an audit event to the caller's transaction (committed with the change it describes)."""
    event = AuditEvent(
        id=new_id("aud"),
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=(reason or None),
        data=data or {},
        request_id=request_id_var.get(),
        created_at=utcnow(),
    )
    db.add(event)
    log.info("audit", extra={"action": action, "actor_id": actor_id, "target_type": target_type, "target_id": target_id})
    return event
