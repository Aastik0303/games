"""Game engine contract and the built-in games.

A ``GameDefinition`` owns everything rule-related for one game: metadata,
which puzzles to deal, the public (answer-free) view of a puzzle, grading,
hints and scoring. Services call these pure methods; they never look at answer
keys themselves, and routes never call games directly.

Solo play: every game. Live multiplayer rounds: games whose ``live`` is True
(text answers graded per round).
"""

from __future__ import annotations

import random
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar

from app.games import content as c
from app.games.grading import is_solved, matches_answer
from app.schemas.games import LogicAnswer, MysteryAnswer, TextAnswer

Answer = TextAnswer | LogicAnswer | MysteryAnswer


@dataclass
class PuzzleProgress:
    """Per-puzzle counters the engine needs for scoring."""

    attempts_used: int = 0
    hints_used: int = 0
    clues_revealed: int = 0


@dataclass(frozen=True)
class Grade:
    correct: bool
    feedback: str
    score_delta: int
    solution: str


class RuleError(ValueError):
    """The answer is malformed for this game (maps to a 422)."""


class GameDefinition(ABC):
    id: ClassVar[str]
    kind: ClassVar[str]
    title: ClassVar[str]
    tagline: ClassVar[str]
    category: ClassVar[str]
    difficulties: ClassVar[tuple[str, ...]]
    modes: ClassVar[tuple[str, ...]]
    turn_mode: ClassVar[str | None] = None
    min_players: ClassVar[int] = 1
    max_players: ClassVar[int] = 1
    est_minutes: ClassVar[int]
    attempts: ClassVar[int] = 3
    per_session: ClassVar[int] = 5
    hints_per_session: ClassVar[int] = 3
    live: ClassVar[bool] = False

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "tagline": self.tagline,
            "category": self.category,
            "difficulties": list(self.difficulties),
            "modes": list(self.modes),
            "turnMode": self.turn_mode,
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "estMinutes": self.est_minutes,
            "enabled": True,
            "minAge": 13,
        }

    @abstractmethod
    def item_ids(self, difficulty: str) -> list[str]: ...

    def deal(self, difficulty: str, rng: random.Random, count: int | None = None) -> list[str]:
        ids = self.item_ids(difficulty)
        if not ids:
            raise RuleError("No puzzles for that difficulty.")
        rng.shuffle(ids)
        return ids[: count or self.per_session]

    @abstractmethod
    def public(self, item_id: str) -> dict[str, Any]:
        """The puzzle as the browser may see it: never contains answers."""

    @abstractmethod
    def grade(self, item_id: str, answer: Answer, progress: PuzzleProgress) -> Grade: ...

    @abstractmethod
    def hint(self, item_id: str, progress: PuzzleProgress) -> str: ...

    def clue(self, item_id: str, clue_id: str) -> dict[str, str] | None:
        return None


class TextGame(GameDefinition):
    items: ClassVar[tuple[c.TextItem, ...]]

    def _item(self, item_id: str) -> c.TextItem:
        for it in self.items:
            if it.id == item_id:
                return it
        raise KeyError(item_id)

    def item_ids(self, difficulty: str) -> list[str]:
        return [it.id for it in self.items if it.difficulty == difficulty]

    def grade(self, item_id: str, answer: Answer, progress: PuzzleProgress) -> Grade:
        if not isinstance(answer, TextAnswer) or answer.kind != self.kind:
            raise RuleError("Answer doesn't match this puzzle.")
        item = self._item(item_id)
        correct = matches_answer(answer.text, item.answers)
        attempt_no = progress.attempts_used + 1
        delta = max(10, (100, 70, 40)[min(attempt_no, 3) - 1] - progress.hints_used * 20) if correct else 0
        feedback = ("Perfect — first try!" if attempt_no == 1 else "Got it!") if correct else "Not quite."
        return Grade(correct, feedback, delta, item.answers[0])

    def live_correct(self, item_id: str, text: str) -> bool:
        return matches_answer(text, self._item(item_id).answers)

    def solution_text(self, item_id: str) -> str:
        return self._item(item_id).answers[0]

    def hint(self, item_id: str, progress: PuzzleProgress) -> str:
        return self._item(item_id).hint


class MissingWord(TextGame):
    id = "missing-word"
    kind = "word"
    title = "Missing Word"
    tagline = "Fill the gap in famous sayings before anyone else."
    category = "Word"
    difficulties = ("easy", "medium")
    modes = ("solo", "multiplayer")
    turn_mode = "simultaneous"
    min_players, max_players, est_minutes = 2, 8, 5
    items = c.WORD_ITEMS
    live = True

    def public(self, item_id: str) -> dict[str, Any]:
        it = self._item(item_id)
        return {"kind": "word", "id": it.id, "prompt": it.prompt, "template": it.template, "letters": len(it.answers[0])}


class RiddleRelay(TextGame):
    id = "riddle-relay"
    kind = "riddle"
    title = "Riddle Relay"
    tagline = "Take turns cracking riddles while the room watches."
    category = "Riddle"
    difficulties = ("easy", "medium")
    modes = ("solo", "multiplayer")
    turn_mode = "turns"
    min_players, max_players, est_minutes = 2, 6, 8
    items = c.RIDDLE_ITEMS
    live = True

    def public(self, item_id: str) -> dict[str, Any]:
        it = self._item(item_id)
        return {"kind": "riddle", "id": it.id, "text": it.text}


class MiniGrid(GameDefinition):
    id = "mini-grid"
    kind = "logic"
    title = "Mini Grid"
    tagline = "A 4×4 number logic puzzle. Calm, clean deduction."
    category = "Logic"
    difficulties = ("easy", "medium", "hard")
    modes = ("solo",)
    est_minutes = 4
    attempts = 5
    per_session = 2

    def _item(self, item_id: str) -> c.LogicItem:
        for it in c.LOGIC_ITEMS:
            if it.id == item_id:
                return it
        raise KeyError(item_id)

    def item_ids(self, difficulty: str) -> list[str]:
        return [it.id for it in c.LOGIC_ITEMS if it.difficulty == difficulty]

    def public(self, item_id: str) -> dict[str, Any]:
        it = self._item(item_id)
        return {"kind": "logic", "id": it.id, "size": 4, "givens": [list(r) for r in it.givens], "rules": c.LOGIC_RULES}

    def grade(self, item_id: str, answer: Answer, progress: PuzzleProgress) -> Grade:
        if not isinstance(answer, LogicAnswer):
            raise RuleError("Answer doesn't match this puzzle.")
        it = self._item(item_id)
        correct = is_solved(answer.grid, it.givens)
        delta = max(20, 150 - progress.attempts_used * 20 - progress.hints_used * 30) if correct else 0
        feedback = (
            "Solved. Every row, column and box checks out." if correct else "Not solved yet — check for repeats or empty cells."
        )
        return Grade(correct, feedback, delta, " / ".join(" ".join(map(str, r)) for r in it.solution))

    def hint(self, item_id: str, progress: PuzzleProgress) -> str:
        it = self._item(item_id)
        empties = [(r, col) for r, row in enumerate(it.givens) for col, v in enumerate(row) if v is None]
        r, col = empties[progress.hints_used % len(empties)]
        return f"Row {r + 1}, column {col + 1} is {it.solution[r][col]}."


class WrenfieldManor(GameDefinition):
    id = "wrenfield-manor"
    kind = "mystery"
    title = "Death at Wrenfield Manor"
    tagline = "A blackout, a cup of tea, four suspects. Inspect clues and name the culprit."
    category = "Mystery"
    difficulties = ("medium",)
    modes = ("solo",)
    est_minutes = 12
    attempts = 1
    per_session = 1

    def _item(self, item_id: str) -> c.MysteryItem:
        for it in c.MYSTERY_ITEMS:
            if it.id == item_id:
                return it
        raise KeyError(item_id)

    def item_ids(self, difficulty: str) -> list[str]:
        return [it.id for it in c.MYSTERY_ITEMS if it.difficulty == difficulty]

    def public(self, item_id: str) -> dict[str, Any]:
        it = self._item(item_id)
        return {
            "kind": "mystery",
            "id": it.id,
            "title": it.title,
            "briefing": it.briefing,
            "suspects": [dict(s) for s in it.suspects],
            "clues": [{"id": cl.id, "title": cl.title, "location": cl.location} for cl in it.clues],
            "methods": list(it.methods),
            "motives": list(it.motives),
        }

    def grade(self, item_id: str, answer: Answer, progress: PuzzleProgress) -> Grade:
        if not isinstance(answer, MysteryAnswer):
            raise RuleError("Answer doesn't match this puzzle.")
        it = self._item(item_id)
        if answer.suspect_id not in {s["id"] for s in it.suspects}:
            raise RuleError("Unknown suspect.")
        if answer.method not in it.methods or answer.motive not in it.motives:
            raise RuleError("Choose a method and a motive from the list.")
        s_ok = answer.suspect_id == it.solution_suspect
        m_ok = answer.method == it.solution_method
        mo_ok = answer.motive == it.solution_motive
        correct = s_ok and m_ok and mo_ok
        delta = max(
            0,
            (60 if s_ok else 0)
            + (20 if m_ok else 0)
            + (20 if mo_ok else 0)
            - max(0, progress.clues_revealed - 5) * 5
            - progress.hints_used * 5,
        )
        parts = [p for p, ok in (("the culprit", s_ok), ("the method", m_ok), ("the motive", mo_ok)) if ok]
        if correct:
            feedback = "Case closed. You named the culprit, the method and the motive."
        elif parts:
            feedback = f"You got {' and '.join(parts)} right."
        else:
            feedback = "The real culprit walks free."
        return Grade(correct, feedback, delta, it.explanation)

    def hint(self, item_id: str, progress: PuzzleProgress) -> str:
        hints = self._item(item_id).hints
        return hints[min(progress.hints_used, len(hints) - 1)]

    def clue(self, item_id: str, clue_id: str) -> dict[str, str] | None:
        for cl in self._item(item_id).clues:
            if cl.id == clue_id:
                return {"id": cl.id, "title": cl.title, "location": cl.location, "detail": cl.detail}
        return None
