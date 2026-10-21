"""The game registry: one place that lists every playable game."""

from __future__ import annotations

from app.games import content as c
from app.games.engine import GameDefinition, MiniGrid, MissingWord, RiddleRelay, TextGame, WrenfieldManor
from app.games.grading import count_solutions, is_solved

GAMES: dict[str, GameDefinition] = {g.id: g for g in (MissingWord(), RiddleRelay(), MiniGrid(), WrenfieldManor())}


def get_game(game_id: str) -> GameDefinition | None:
    return GAMES.get(game_id)


def live_game(game_id: str) -> TextGame | None:
    g = GAMES.get(game_id)
    return g if isinstance(g, TextGame) and g.live else None


def validate_content() -> list[str]:
    """Static checks run at startup and in CI. Returns a list of problems (empty = OK)."""
    problems: list[str] = []
    seen: set[str] = set()
    for item in (*c.WORD_ITEMS, *c.RIDDLE_ITEMS):
        if item.id in seen:
            problems.append(f"duplicate id {item.id}")
        seen.add(item.id)
        if not item.answers or not all(a.strip() for a in item.answers):
            problems.append(f"{item.id}: empty answer")
        if item.difficulty not in ("easy", "medium", "hard"):
            problems.append(f"{item.id}: bad difficulty")
    for w in c.WORD_ITEMS:
        if w.template.count("___") != 1:
            problems.append(f"{w.id}: template needs exactly one ___")
    for g in c.LOGIC_ITEMS:
        if not is_solved(g.solution, g.givens):
            problems.append(f"{g.id}: stored solution is invalid")
        if count_solutions(g.givens) != 1:
            problems.append(f"{g.id}: givens do not have a unique solution")
    for m in c.MYSTERY_ITEMS:
        if m.solution_suspect not in {s["id"] for s in m.suspects}:
            problems.append(f"{m.id}: unknown culprit")
        if m.solution_method not in m.methods or m.solution_motive not in m.motives:
            problems.append(f"{m.id}: solution not among options")
        if len({cl.id for cl in m.clues}) != len(m.clues):
            problems.append(f"{m.id}: duplicate clue ids")
    for game in GAMES.values():
        for d in game.difficulties:
            if len(game.item_ids(d)) < game.per_session:
                problems.append(f"{game.id}/{d}: fewer items than one session needs")
    return problems
