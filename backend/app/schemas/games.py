from __future__ import annotations

from typing import Annotated, ClassVar, Literal

from pydantic import Field, field_validator

from app.schemas.common import CamelModel, Difficulty, GameKind, StrictInput

PlayMode = Literal["solo", "multiplayer"]


class GameSummary(CamelModel):
    omit_none: ClassVar[frozenset[str]] = frozenset({"turn_mode"})

    id: str
    kind: GameKind
    title: str
    tagline: str
    category: Literal["Word", "Riddle", "Logic", "Mystery"]
    difficulties: list[Difficulty]
    modes: list[PlayMode]
    turn_mode: Literal["simultaneous", "turns"] | None = None
    min_players: int
    max_players: int
    est_minutes: int
    enabled: bool
    # Content-safety tag: every shipped game is reviewed as suitable for 13+.
    min_age: int = 13


class Suspect(CamelModel):
    id: str
    name: str
    role: str
    statement: str


class ClueStub(CamelModel):
    id: str
    title: str
    location: str


class RevealedClue(ClueStub):
    detail: str


class WordPuzzle(CamelModel):
    kind: Literal["word"] = "word"
    id: str
    prompt: str
    template: str
    letters: int


class RiddlePuzzle(CamelModel):
    kind: Literal["riddle"] = "riddle"
    id: str
    text: str


class LogicPuzzle(CamelModel):
    kind: Literal["logic"] = "logic"
    id: str
    size: Literal[4] = 4
    givens: list[list[int | None]]
    rules: str


class MysteryPuzzle(CamelModel):
    kind: Literal["mystery"] = "mystery"
    id: str
    title: str
    briefing: str
    suspects: list[Suspect]
    clues: list[ClueStub]
    methods: list[str]
    motives: list[str]


PublicPuzzle = Annotated[WordPuzzle | RiddlePuzzle | LogicPuzzle | MysteryPuzzle, Field(discriminator="kind")]


class TextAnswer(CamelModel):
    kind: Literal["word", "riddle"]
    text: str = Field(min_length=1, max_length=60)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Enter an answer.")
        return v


class LogicAnswer(CamelModel):
    kind: Literal["logic"]
    grid: list[list[int]] = Field(min_length=4, max_length=4)

    @field_validator("grid")
    @classmethod
    def _shape(cls, v: list[list[int]]) -> list[list[int]]:
        if any(len(row) != 4 for row in v):
            raise ValueError("The grid must be 4×4.")
        if any(not 0 <= n <= 4 for row in v for n in row):
            raise ValueError("Cells hold 1–4.")
        return v


class MysteryAnswer(CamelModel):
    kind: Literal["mystery"]
    suspect_id: str = Field(max_length=40)
    method: str = Field(max_length=120)
    motive: str = Field(max_length=120)


PuzzleAnswer = Annotated[TextAnswer | LogicAnswer | MysteryAnswer, Field(discriminator="kind")]


class AnswerResult(CamelModel):
    omit_none: ClassVar[frozenset[str]] = frozenset({"solution"})

    correct: bool
    feedback: str
    score_delta: int
    total_score: int
    attempts_left: int
    solution: str | None = None
    closed: bool


class SoloStart(StrictInput):
    game_id: str = Field(max_length=40)
    difficulty: Difficulty


class SoloAnswerIn(StrictInput):
    answer: PuzzleAnswer


class SoloSession(CamelModel):
    id: str
    game_id: str
    difficulty: Difficulty
    index: int
    total: int
    score: int
    status: Literal["active", "complete"]
    puzzle: PublicPuzzle
    hints_left: int
    revealed_clues: list[RevealedClue]


class HintOut(CamelModel):
    hint: str
    hints_left: int


class GameState(CamelModel):
    omit_none: ClassVar[frozenset[str]] = frozenset({"last_reveal"})

    game_id: str
    kind: GameKind
    title: str
    round: int
    total_rounds: int
    phase: Literal["countdown", "answering", "reveal", "finished"]
    puzzle: PublicPuzzle | None
    turn: dict[str, str]
    ends_at: str | None
    scores: dict[str, int]
    solved_by: list[str]
    last_reveal: dict[str, object] | None = None
