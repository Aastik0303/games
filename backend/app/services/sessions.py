"""Guest profiles and sessions.

Token design: a 256-bit random token in an HttpOnly cookie. Redis stores only
its SHA-256 digest -> {uid, exp}, so a Redis dump can't be replayed as a
cookie. The profile itself is durable (database); the session is ephemeral.
"""

from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select

from app.db.models import Block, User
from app.errors import AppError
from app.infra import Infra, avatar_hue, new_id
from app.redis import keys
from app.schemas.common import iso, utcnow
from app.schemas.profile import MINOR_BANDS, PrivacySettings, ProfileInput, PublicUser
from app.services import audit

MINOR_PRIVACY = {"invitePolicy": "matched_only", "chatFilter": "strict"}


@dataclass
class Principal:
    """The authenticated caller."""

    user: User
    token_digest: str
    expires_ms: int

    @property
    def id(self) -> str:
        return self.user.id

    @property
    def roles(self) -> set[str]:
        return set(self.user.roles or [])

    def public(self) -> dict[str, Any]:
        return {"id": self.user.id, "displayName": self.user.display_name, "avatarHue": self.user.avatar_hue, "isBot": False}


def public_user(user: User) -> dict[str, Any]:
    return PublicUser(id=user.id, display_name=user.display_name, avatar_hue=user.avatar_hue).model_dump(by_alias=True)


def effective_privacy(user: User) -> dict[str, Any]:
    p = PrivacySettings.model_validate(user.privacy or {}).model_dump(by_alias=True)
    if user.is_minor:
        p.update(MINOR_PRIVACY)
    return p


class SessionService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra

    @property
    def ttl(self) -> int:
        return self.infra.settings.session_ttl_sec

    # --- tokens -----------------------------------------------------------
    async def _issue(self, user_id: str) -> tuple[str, int]:
        token = secrets.token_urlsafe(32)
        digest = keys.token_hash(token)
        exp = int(time.time() * 1000) + self.ttl * 1000
        pipe = self.infra.redis.pipeline(transaction=True)
        pipe.set(keys.session(digest), json.dumps({"uid": user_id, "exp": exp}), ex=self.ttl)
        pipe.sadd(keys.user_sessions(user_id), digest)
        pipe.expire(keys.user_sessions(user_id), self.ttl)
        await pipe.execute()
        return token, exp

    async def _revoke_digest(self, digest: str, user_id: str | None = None) -> None:
        pipe = self.infra.redis.pipeline(transaction=False)
        pipe.delete(keys.session(digest))
        if user_id:
            pipe.srem(keys.user_sessions(user_id), digest)
        await pipe.execute()

    async def revoke_all(self, user_id: str) -> None:
        digests: set[str] = await self.infra.redis.smembers(keys.user_sessions(user_id))  # type: ignore[misc]
        if digests:
            await self.infra.redis.delete(*[keys.session(d) for d in digests])
        await self.infra.redis.delete(keys.user_sessions(user_id))
        await self.infra.services.events.publish_user(user_id, "_session.revoked", {})

    async def resolve(self, token: str | None) -> Principal | None:
        if not token or len(token) > 128:
            return None
        return await self.resolve_digest(keys.token_hash(token))

    async def resolve_digest(self, digest: str) -> Principal | None:
        raw = await self.infra.redis.get(keys.session(digest))
        if not raw:
            return None
        data = json.loads(raw)
        async with self.infra.db() as db:
            user = await db.get(User, data["uid"])
        if user is None:
            await self._revoke_digest(digest)
            return None
        if user.status == "suspended":
            until = user.suspended_until
            if until is None or until.replace(tzinfo=until.tzinfo or UTC) > utcnow():
                await self._revoke_digest(digest, user.id)
                return None
        return Principal(user=user, token_digest=digest, expires_ms=int(data["exp"]))

    async def is_live(self, digest: str) -> bool:
        return bool(await self.infra.redis.exists(keys.session(digest)))

    # --- profile ------------------------------------------------------------
    async def create(self, profile: ProfileInput, current: Principal | None) -> tuple[str, Principal]:
        now = utcnow()
        is_minor = profile.age_band in MINOR_BANDS
        async with self.infra.db() as db:
            user = await db.get(User, current.id) if current else None
            if user is None:
                uid = new_id("u")
                user = User(
                    id=uid,
                    avatar_hue=avatar_hue(uid),
                    roles=["player"],
                    status="active",
                    created_at=now,
                    privacy=PrivacySettings().model_dump(by_alias=True),
                    consent_guidelines_at=now,
                    display_name="",
                    age_band="",
                    is_minor=False,
                    language="en",
                    interests=[],
                    accessibility={},
                    matching={},
                    consent_interests=False,
                    updated_at=now,
                    last_seen_at=now,
                )
                db.add(user)
            else:
                self._check_band_change(user, profile.age_band)
            self._apply(user, profile, is_minor, now)
            await db.commit()
        # Rotate the token on every profile creation (prevents session fixation).
        if current:
            await self._revoke_digest(current.token_digest, current.id)
        token, exp = await self._issue(user.id)
        return token, Principal(user=user, token_digest=keys.token_hash(token), expires_ms=exp)

    async def update_profile(self, principal: Principal, profile: ProfileInput) -> Principal:
        async with self.infra.db() as db:
            user = await db.get(User, principal.id)
            if user is None:
                raise AppError("session_expired", "Session expired")
            self._check_band_change(user, profile.age_band)
            self._apply(user, profile, profile.age_band in MINOR_BANDS, utcnow())
            await db.commit()
        principal.user = user
        return principal

    @staticmethod
    def _check_band_change(user: User, new_band: str) -> None:
        # Moving from a minor band to an adult band would remove safety defaults, so it
        # needs a fresh profile rather than an edit.
        if user.is_minor and new_band not in MINOR_BANDS:
            raise AppError(
                "validation",
                "To change your age band, sign out and create a new profile.",
                fields={"ageBand": "Sign out and create a new profile to change this."},
            )

    @staticmethod
    def _apply(user: User, p: ProfileInput, is_minor: bool, now: datetime) -> None:
        user.display_name = p.display_name
        user.age_band = p.age_band
        user.is_minor = is_minor
        user.language = p.language
        user.interests = list(p.interests)
        user.accessibility = p.accessibility.model_dump(by_alias=True)
        user.matching = p.matching.model_dump(by_alias=True)
        user.consent_interests = p.consent.use_interests_for_matching
        user.updated_at = user.last_seen_at = now
        if is_minor:
            privacy = dict(user.privacy or {})
            privacy.update(MINOR_PRIVACY)
            user.privacy = privacy

    async def refresh(self, principal: Principal) -> Principal:
        async with self.infra.db() as db:
            user = await db.get(User, principal.id)
            if user is not None:
                user.last_seen_at = utcnow()  # drives guest-profile retention
                await db.commit()
        exp = int(time.time() * 1000) + self.ttl * 1000
        await self.infra.redis.set(
            keys.session(principal.token_digest), json.dumps({"uid": principal.id, "exp": exp}), ex=self.ttl
        )
        await self.infra.redis.expire(keys.user_sessions(principal.id), self.ttl)
        principal.expires_ms = exp
        return principal

    async def destroy(self, principal: Principal) -> None:
        """Sign out and delete the guest's personal data. Reports keep only pseudonymous ids."""
        uid = principal.id
        await self.infra.services.rooms.leave_all(principal)
        await self.infra.services.matchmaking.cancel_for_user(uid)
        await self.revoke_all(uid)
        async with self.infra.db() as db:
            await db.execute(delete(Block).where((Block.blocker_id == uid) | (Block.blocked_id == uid)))
            user = await db.get(User, uid)
            if user is not None:
                await db.delete(user)
            audit.record(db, actor_id=uid, action="profile.deleted", target_type="user", target_id=uid)
            await db.commit()

    def to_session(self, principal: Principal) -> dict[str, Any]:
        u = principal.user
        profile = {
            "id": u.id,
            "displayName": u.display_name,
            "ageBand": u.age_band,
            "language": u.language,
            "interests": list(u.interests or []),
            "accessibility": u.accessibility,
            "matching": u.matching,
            "consent": {"guidelinesAccepted": True, "useInterestsForMatching": u.consent_interests},
            "isMinor": u.is_minor,
            "createdAt": iso(u.created_at),
        }
        return {
            "user": {
                "id": u.id,
                "displayName": u.display_name,
                "avatarHue": u.avatar_hue,
                "isBot": False,
                "roles": list(u.roles or ["player"]),
            },
            "profile": profile,
            "expiresAt": iso(datetime.fromtimestamp(principal.expires_ms / 1000, UTC)),
        }

    # --- privacy ------------------------------------------------------------
    async def set_privacy(self, principal: Principal, settings: PrivacySettings) -> dict[str, Any]:
        async with self.infra.db() as db:
            user = await db.get(User, principal.id)
            if user is None:
                raise AppError("session_expired", "Session expired")
            user.privacy = settings.model_dump(by_alias=True)
            user.updated_at = utcnow()
            await db.commit()
        principal.user = user
        return effective_privacy(user)

    async def get_users(self, ids: list[str]) -> dict[str, User]:
        if not ids:
            return {}
        async with self.infra.db() as db:
            rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
        return {u.id: u for u in rows}
