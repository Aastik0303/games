from __future__ import annotations

import json

from app.games import content as c
from app.games.engine import PuzzleProgress
from app.games.grading import is_solved, matches_answer
from app.games.registry import GAMES, validate_content
from app.redis import keys
from app.schemas.games import TextAnswer
from tests.conftest import Api

ALL_ANSWERS = {a for item in (*c.WORD_ITEMS, *c.RIDDLE_ITEMS) for a in item.answers}


def test_content_is_valid() -> None:
    assert validate_content() == []


def test_answer_matching_is_forgiving_but_exact() -> None:
    assert matches_answer("  The Piano! ", ["piano"])
    assert matches_answer("footstep", ["footsteps"])
    assert matches_answer("Écho", ["echo"])
    assert not matches_answer("pian", ["piano"])
    assert not matches_answer("", ["piano"])


def test_public_puzzles_never_contain_answers() -> None:
    for game in GAMES.values():
        for d in game.difficulties:
            for item_id in game.item_ids(d):
                public = json.dumps(game.public(item_id)).lower()
                if game.kind in ("word", "riddle"):
                    item = next(i for i in (*c.WORD_ITEMS, *c.RIDDLE_ITEMS) if i.id == item_id)
                    for a in item.answers:
                        assert f'"{a.lower()}"' not in public
                if game.kind == "logic":
                    item = next(i for i in c.LOGIC_ITEMS if i.id == item_id)
                    assert json.dumps([list(r) for r in item.solution]) not in public
                if game.kind == "mystery":
                    assert "explanation" not in public and "detail" not in public
                    assert c.WRENFIELD.explanation[:40].lower() not in public


def test_scoring_rules() -> None:
    word = GAMES["missing-word"]
    grade = word.grade("w1", TextAnswer(kind="word", text="words"), PuzzleProgress())
    assert grade.correct and grade.score_delta == 100
    grade = word.grade("w1", TextAnswer(kind="word", text="words"), PuzzleProgress(attempts_used=1, hints_used=1))
    assert grade.score_delta == 50
    assert is_solved([[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]], c.LOGIC_ITEMS[0].givens)


def _start(api: Api, game_id: str, difficulty: str = "easy") -> dict:
    r = api.post("/v1/solo/sessions", {"gameId": game_id, "difficulty": difficulty})
    assert r.status_code == 200, r.text
    return r.json()


def _answer_for(api: Api, session_id: str) -> str:
    async def go() -> str:
        _, doc = await api.infra.docs.get(keys.solo_doc(session_id))
        item_id = doc["items"][doc["index"]]
        item = next(i for i in (*c.WORD_ITEMS, *c.RIDDLE_ITEMS) if i.id == item_id)
        return item.answers[0]

    return str(api.run(go))


def test_solo_word_session_end_to_end(api: Api) -> None:
    api.signup()
    s = _start(api, "missing-word")
    assert s["total"] == 5 and s["puzzle"]["kind"] == "word"
    for a in ALL_ANSWERS:
        assert f'"{a}"' not in json.dumps(s)
    wrong = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "word", "text": "zzz"}}).json()
    assert wrong == {
        "correct": False,
        "feedback": "Not quite.",
        "scoreDelta": 0,
        "totalScore": 0,
        "attemptsLeft": 2,
        "closed": False,
    }
    answer = _answer_for(api, s["id"])
    right = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "word", "text": answer}}).json()
    assert right["correct"] and right["closed"] and right["solution"] == answer and right["scoreDelta"] == 70
    again = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "word", "text": answer}})
    assert again.status_code == 409  # closed puzzles can't be re-scored
    nxt = api.post(f"/v1/solo/sessions/{s['id']}/advance").json()
    assert nxt["index"] == 1 and nxt["score"] == 70


def test_solo_attempts_run_out_and_reveal_solution(api: Api) -> None:
    api.signup()
    s = _start(api, "riddle-relay")
    last = None
    for _ in range(3):
        last = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "riddle", "text": "nope"}}).json()
    assert last["closed"] and last["attemptsLeft"] == 0 and last["solution"]


def test_idempotency_key_prevents_double_spend(api: Api) -> None:
    api.signup()
    s = _start(api, "missing-word")
    h = {"Idempotency-Key": "k1-abc"}
    a = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "word", "text": "zzz"}}, headers=h).json()
    b = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "word", "text": "zzz"}}, headers=h).json()
    assert a == b and a["attemptsLeft"] == 2


def test_wrong_answer_kind_and_foreign_session(api: Api) -> None:
    api.signup()
    s = _start(api, "missing-word")
    r = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "logic", "grid": [[1] * 4] * 4}})
    assert r.status_code == 422
    other = api.another()
    other.signup("Other")
    r = other.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "word", "text": "x"}})
    assert r.status_code == 404  # someone else's session looks like a missing one


def test_logic_grid_grading_and_hints(api: Api) -> None:
    api.signup()
    s = _start(api, "mini-grid", "easy")
    sol = next(i for i in c.LOGIC_ITEMS if i.id == s["puzzle"]["id"]).solution
    hint = api.post(f"/v1/solo/sessions/{s['id']}/hints").json()
    assert hint["hintsLeft"] == 2 and hint["hint"].startswith("Row")
    bad = [[1, 1, 1, 1]] * 4
    assert not api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "logic", "grid": bad}}).json()["correct"]
    good = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "logic", "grid": [list(r) for r in sol]}}).json()
    assert good["correct"] and good["scoreDelta"] == 100  # 150 - 1 wrong*20 - 1 hint*30
    malformed = api.post(f"/v1/solo/sessions/{s['id']}/answers", {"answer": {"kind": "logic", "grid": [[1, 2]]}})
    assert malformed.status_code == 422


def test_mystery_clues_and_solution(api: Api) -> None:
    api.signup()
    s = _start(api, "wrenfield-manor", "medium")
    assert "detail" not in json.dumps(s["puzzle"]["clues"])
    clue = api.post(f"/v1/solo/sessions/{s['id']}/clues/bag").json()
    assert clue["detail"].startswith("Dr. Hale")
    assert api.post(f"/v1/solo/sessions/{s['id']}/clues/nope").status_code == 404
    unknown = api.post(
        f"/v1/solo/sessions/{s['id']}/answers",
        {"answer": {"kind": "mystery", "suspectId": "ghost", "method": "x", "motive": "y"}},
    )
    assert unknown.status_code == 422
    res = api.post(
        f"/v1/solo/sessions/{s['id']}/answers",
        {
            "answer": {
                "kind": "mystery",
                "suspectId": "hale",
                "method": "Poison in the honey jar",
                "motive": "To silence a report of malpractice",
            }
        },
    ).json()
    assert res["correct"] and res["closed"] and "Hale" in res["solution"]


def test_disabled_game_is_unavailable(api: Api) -> None:
    api.signup()
    api.grant("admin")
    assert api.patch("/v1/admin/games/mini-grid", {"enabled": False}).status_code == 200
    assert api.post("/v1/solo/sessions", {"gameId": "mini-grid", "difficulty": "easy"}).status_code == 404
    assert "mini-grid" not in {g["id"] for g in api.get("/v1/games").json()}
