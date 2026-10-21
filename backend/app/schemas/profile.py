from __future__ import annotations

import re
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.common import CamelModel, StrictInput

AgeBand = Literal["13_15", "16_17", "18_24", "25_34", "35_49", "50_plus"]
MINOR_BANDS: frozenset[str] = frozenset({"13_15", "16_17"})
Language = Literal["en", "es", "fr", "de", "hi", "pt", "ja"]
Interest = Literal["wordplay", "riddles", "logic", "mysteries", "trivia", "films", "anime", "music", "science", "history"]
Role = Literal["player", "admin", "moderator"]
PlayStyle = Literal["casual", "competitive", "any"]

# Mirrors the frontend's checks (profile-validation.ts); the server is authoritative.
_NAME_OK = re.compile(r"^[^\W_][\w .\-]*$", re.UNICODE)
_CONTACT_LIKE = re.compile(r"(@|https?:|www\.|\.(com|net|org|io)\b|\d{6,})", re.IGNORECASE)
MAX_INTERESTS = 5


def clean_display_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not 2 <= len(name) <= 24:
        raise ValueError("Display name must be 2–24 characters.")
    if not _NAME_OK.match(name):
        raise ValueError("Use letters, numbers, spaces, dots, dashes or underscores.")
    if _CONTACT_LIKE.search(name):
        raise ValueError("Display names can't contain contact details or links.")
    return name


class AccessibilityPrefs(CamelModel):
    captions: bool = False
    screen_reader_optimized: bool = False
    color_safe_palette: bool = False
    extended_timers: bool = False


class MatchingPrefs(CamelModel):
    prefer_shared_interests: bool = False
    prefer_same_language: bool = True
    play_style: PlayStyle = "any"


class Consent(CamelModel):
    guidelines_accepted: Literal[True]
    use_interests_for_matching: bool = False


class ProfileInput(CamelModel):
    display_name: str = Field(max_length=64)
    age_band: AgeBand
    language: Language
    interests: list[Interest] = Field(default_factory=list, max_length=MAX_INTERESTS)
    accessibility: AccessibilityPrefs = Field(default_factory=AccessibilityPrefs)
    matching: MatchingPrefs = Field(default_factory=MatchingPrefs)
    consent: Consent

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: str) -> str:
        return clean_display_name(v)

    @field_validator("interests")
    @classmethod
    def _dedupe(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))

    @model_validator(mode="after")
    def _interests_need_consent(self) -> ProfileInput:
        # Interests are only kept when the person opted in to interest-based matching.
        if not self.consent.use_interests_for_matching:
            self.interests = []
            self.matching.prefer_shared_interests = False
        return self


class Profile(ProfileInput):
    id: str
    is_minor: bool
    created_at: str


class PublicUser(CamelModel):
    id: str
    display_name: str
    avatar_hue: int
    is_bot: bool = False


class SessionUser(PublicUser):
    roles: list[Role]


class SessionOut(CamelModel):
    user: SessionUser
    profile: Profile
    expires_at: str


class SessionCreate(StrictInput):
    profile: ProfileInput


class PrivacySettings(StrictInput):
    show_online_status: bool = True
    invite_policy: Literal["anyone_with_code", "matched_only"] = "anyone_with_code"
    chat_filter: Literal["standard", "strict"] = "standard"
