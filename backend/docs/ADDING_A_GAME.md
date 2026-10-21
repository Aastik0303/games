# Adding a game

Games are plain Python classes in `app/games/engine.py`. They hold all rules and no I/O. Services handle storage, timing and transport.

## 1. Content

Add items to `app/games/content.py` and bump `CONTENT_VERSION`. Every item needs a stable `id` and a `difficulty`. Keep answer keys only here: they never leave the server.

## 2. Definition

```python
class CapitalCities(TextGame):          # TextGame = free-text answers; subclass GameDefinition for anything else
    id = "capital-cities"
    kind = "word"                       # must be a GameKind the frontend can render
    title = "Capital Cities"
    tagline = "Name the capital."
    category = "Word"
    difficulties = ("easy", "medium")
    modes = ("solo", "multiplayer")
    turn_mode = "simultaneous"          # or "turns"
    min_players, max_players, est_minutes = 2, 6, 5
    attempts = 3                        # per puzzle (solo)
    per_session = 5                     # puzzles dealt per session / rounds per live game
    hints_per_session = 3
    live = True                         # allow live multiplayer rounds
    items = c.CAPITAL_ITEMS

    def public(self, item_id):          # what the browser may see: NO answers
        it = self._item(item_id)
        return {"kind": "word", "id": it.id, "prompt": "Capital of…", "template": f"{it.text}: ___", "letters": len(it.answers[0])}
```

The contract every game implements:

| Method | Purpose |
|---|---|
| `item_ids(difficulty)` / `deal(difficulty, rng)` | which puzzles exist and the seeded deal (the seed is stored, so sessions are reproducible) |
| `public(item_id)` | answer-free view for the client |
| `grade(item_id, answer, progress)` → `Grade(correct, feedback, score_delta, solution)` | server-side validation and scoring. `solution` is revealed only once the puzzle closes. Raise `RuleError` for malformed answers |
| `hint(item_id, progress)` | staged hints. The service enforces the budget |
| `clue(item_id, clue_id)` | optional, for clue-reveal games |
| `live_correct(item_id, text)`, `solution_text(item_id)` | for `live = True` text games |

## 3. Register

Add an instance to `GAMES` in `app/games/registry.py`. `validate_content()` runs at startup and in CI. Extend it with checks for your content (e.g. that a logic puzzle has a unique solution).

## 4. Frontend

If the game reuses an existing `kind` (`word`, `riddle`, `logic`, `mystery`), the frontend renders it with no changes. A new kind needs a `PublicPuzzle`/`PuzzleAnswer` variant in `frontend/src/lib/api/types.ts`, a renderer, and matching Pydantic models in `app/schemas/games.py`.

## 5. Test

Add cases to `tests/test_games.py`:
- the public view contains no answer for any item,
- right, wrong and malformed answers,
- scoring with attempts and hints,
- the solution only appears once the puzzle is closed.

## Not yet built

The cooperative shared-clue puzzle (prompt item 15) isn't implemented. The engine supports it: shared state would live in the room doc's `game` runtime like live rounds, with per-player clue reveals as private user events. It needs its own round controller in `app/services/live.py` and a frontend view.
