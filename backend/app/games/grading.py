"""Pure grading helpers shared by solo and live games."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from itertools import permutations

_ARTICLE = re.compile(r"^(a|an|the)\s+")
_NON_WORD = re.compile(r"[^\w\s]|_", re.UNICODE)


def normalize_answer(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).lower()
    t = _NON_WORD.sub("", t)
    t = " ".join(t.split())
    return _ARTICLE.sub("", t)


def matches_answer(guess: str, accepted: Sequence[str]) -> bool:
    """Accepts any listed variant, ignoring case, accents, punctuation, a leading article and a plural "s"."""
    g = normalize_answer(guess)
    if not g:
        return False
    for a in accepted:
        n = normalize_answer(a)
        if g in (n, f"{n}s") or f"{g}s" == n:
            return True
    return False


Grid = Sequence[Sequence[int | None]]


def _units() -> list[list[tuple[int, int]]]:
    rows = [[(r, c) for c in range(4)] for r in range(4)]
    cols = [[(r, c) for r in range(4)] for c in range(4)]
    boxes = [[(r, c) for r in range(br, br + 2) for c in range(bc, bc + 2)] for br in (0, 2) for bc in (0, 2)]
    return rows + cols + boxes


UNITS = _units()


def is_solved(grid: Grid, givens: Grid) -> bool:
    """Complete, conflict-free, and every given preserved."""
    if len(grid) != 4 or any(len(row) != 4 for row in grid):
        return False
    if any(v is None or not 1 <= v <= 4 for row in grid for v in row):
        return False
    for unit in UNITS:
        if len({grid[r][c] for r, c in unit}) != 4:
            return False
    return all(g is None or grid[r][c] == g for r, row in enumerate(givens) for c, g in enumerate(row))


def count_solutions(givens: Grid, limit: int = 2) -> int:
    """Brute-force solution count (4×4 is tiny). Used to validate content has exactly one answer."""
    found = 0
    perms = list(permutations((1, 2, 3, 4)))

    def rows_ok(rows: list[tuple[int, ...]]) -> bool:
        r = len(rows) - 1
        if any(givens[r][c] is not None and givens[r][c] != rows[r][c] for c in range(4)):
            return False
        for c in range(4):
            if len({row[c] for row in rows}) != len(rows):
                return False
        if r % 2 == 1:
            for bc in (0, 2):
                box = {rows[rr][cc] for rr in (r - 1, r) for cc in (bc, bc + 1)}
                if len(box) != 4:
                    return False
        return True

    def search(rows: list[tuple[int, ...]]) -> None:
        nonlocal found
        if found >= limit:
            return
        if len(rows) == 4:
            found += 1
            return
        for p in perms:
            rows.append(p)
            if rows_ok(rows):
                search(rows)
            rows.pop()

    search([])
    return found
