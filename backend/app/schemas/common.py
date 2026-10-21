"""Base model and shared types. JSON uses camelCase to match the TypeScript contract."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, SerializerFunctionWrapHandler, model_serializer
from pydantic.alias_generators import to_camel

Difficulty = Literal["easy", "medium", "hard"]
GameKind = Literal["word", "riddle", "logic", "mystery"]
ActivityKind = Literal["word", "riddle", "logic", "mystery", "watch"]


def utcnow() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime | None = None) -> str:
    """ISO-8601 in UTC with millisecond precision and a Z suffix, like JS toISOString()."""
    d = dt or utcnow()
    # SQLite returns naive datetimes; everything is stored in UTC.
    d = d.replace(tzinfo=UTC) if d.tzinfo is None else d.astimezone(UTC)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def iso_ms(ms: float) -> str:
    return iso(datetime.fromtimestamp(ms / 1000, UTC))


class CamelModel(BaseModel):
    """Request/response base: camelCase on the wire. Top-level request bodies use ``StrictInput``.

    Fields listed in ``omit_none`` are left out of the JSON when they are None,
    matching optional (``field?: T``) properties in the TypeScript contract.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")
    omit_none: ClassVar[frozenset[str]] = frozenset()

    @model_serializer(mode="wrap")
    def _drop_optional_nones(self, handler: SerializerFunctionWrapHandler) -> Any:
        data = handler(self)
        if self.omit_none and isinstance(data, dict):
            for name in self.omit_none:
                for key in (name, to_camel(name)):
                    if key in data and data[key] is None:
                        del data[key]
        return data


class StrictInput(CamelModel):
    """Request bodies: unknown top-level fields are rejected rather than silently dropped."""

    model_config = ConfigDict(extra="forbid")


class OkResponse(CamelModel):
    ok: Literal[True] = True
