"""Server-authoritative live rounds driven by distributed timers."""

from __future__ import annotations

import json

from app.games import content as c
from app.redis import keys
from tests.conftest import Api, command, now_ms, wait_for


def _setup(api: Api, game_id: str, kind: str) -> tuple[dict, Api, dict, dict]:
    host = api.signup("Host")
    room = api.post("/v1/rooms", {"activity": {"kind": kind, "gameId": game_id, "difficulty": "easy"}, "capacity": 3}).json()
    guest = api.another()
    g = guest.signup("Guest")
    guest.post(f"/v1/rooms/{room['code']}/join")
    return room, guest, host, g


def _answer(api: Api, room_id: str, rnd: int) -> str:
    async def go() -> str:
        _, doc = await api.infra.docs.get(keys.room_doc(room_id))
        item_id = doc["game"]["items"][rnd - 1]
        return next(i for i in (*c.WORD_ITEMS, *c.RIDDLE_ITEMS) if i.id == item_id).answers[0]

    return str(api.run(go))


def _state(ws) -> dict:  # type: ignore[no-untyped-def]
    return dict(wait_for(ws, "game.state")["payload"]["state"])


def test_simultaneous_round_scoring_and_reveal(api: Api) -> None:
    room, guest, host, g = _setup(api, "missing-word", "word")
    rid = room["id"]
    with api.connect() as hws, guest.connect() as gws:
        command(hws, "room.subscribe", {"roomId": rid})
        command(gws, "room.subscribe", {"roomId": rid})
        wait_for(gws, "room.snapshot")
        command(gws, "room.set_ready", {"roomId": rid, "ready": True})
        assert command(hws, "room.start", {"roomId": rid})["ok"]
        assert _state(gws)["phase"] == "countdown"

        early = command(gws, "game.submit", {"roomId": rid, "round": 1, "answer": {"kind": "word", "text": "x"}})
        assert early["error"]["code"] == "conflict"  # no answers during the countdown

        api.fire_timers()  # countdown -> round 1
        st = _state(gws)
        assert st["phase"] == "answering" and st["round"] == 1 and st["turn"] == {"mode": "simultaneous"}
        answer = _answer(api, rid, 1)
        assert answer not in json.dumps(st)  # no answer key in public state

        wrong = command(gws, "game.submit", {"roomId": rid, "round": 1, "answer": {"kind": "word", "text": "nah"}})
        assert wrong["data"] == {"correct": False, "attemptsLeft": 2}
        right = command(gws, "game.submit", {"roomId": rid, "round": 1, "answer": {"kind": "word", "text": answer}})
        assert right["data"] == {"correct": True, "attemptsLeft": 1}
        again = command(gws, "game.submit", {"roomId": rid, "round": 1, "answer": {"kind": "word", "text": answer}})
        assert again["error"]["message"] == "You already solved this round"
        stale = command(hws, "game.submit", {"roomId": rid, "round": 2, "answer": {"kind": "word", "text": answer}})
        assert stale["error"]["code"] == "conflict"
        host_right = command(hws, "game.submit", {"roomId": rid, "round": 1, "answer": {"kind": "word", "text": answer}})
        assert host_right["data"]["correct"]

        api.fire_timers()  # everyone solved -> reveal (and the original deadline is a no-op)
        st = None
        for _ in range(10):
            st = _state(gws)
            if st["phase"] == "reveal":
                break
        assert st and st["lastReveal"]["solution"] == answer
        assert st["scores"][g["user"]["id"]] == 100 and st["scores"][host["user"]["id"]] == 70


def test_turn_based_game_rejects_out_of_turn(api: Api) -> None:
    room, guest, host, g = _setup(api, "riddle-relay", "riddle")
    rid = room["id"]
    with api.connect() as hws, guest.connect() as gws:
        command(hws, "room.subscribe", {"roomId": rid})
        command(gws, "room.subscribe", {"roomId": rid})
        command(gws, "room.set_ready", {"roomId": rid, "ready": True})
        command(hws, "room.start", {"roomId": rid})
        api.fire_timers()
        st = None
        for _ in range(10):
            st = _state(gws)
            if st["phase"] == "answering":
                break
        assert st and st["turn"] == {"mode": "turns", "activeUserId": host["user"]["id"]}
        answer = _answer(api, rid, 1)
        out_of_turn = command(gws, "game.submit", {"roomId": rid, "round": 1, "answer": {"kind": "riddle", "text": answer}})
        assert out_of_turn["error"]["code"] == "not_your_turn"
        assert command(hws, "game.submit", {"roomId": rid, "round": 1, "answer": {"kind": "riddle", "text": answer}})["data"][
            "correct"
        ]


def test_game_runs_to_finish_and_stale_timers_are_noops(api: Api) -> None:
    room, guest, _, _ = _setup(api, "missing-word", "word")
    rid = room["id"]
    with api.connect() as hws:
        command(hws, "room.subscribe", {"roomId": rid})
        guest_ready = guest.another()
        guest_ready.cookies = guest.cookies
        with guest.connect() as gws:
            command(gws, "room.subscribe", {"roomId": rid})
            command(gws, "room.set_ready", {"roomId": rid, "ready": True})
        command(hws, "room.start", {"roomId": rid})
        for _ in range(20):  # countdown, 5 x (answering, reveal), finish
            api.fire_timers()
        doc = api.run(api.infra.docs.get, keys.room_doc(rid))[1]
        assert doc["game"]["state"]["phase"] == "finished" and doc["game"]["state"]["puzzle"] is None
        # A duplicated/late timer for an old round changes nothing.
        api.run(api.infra.services.live.on_timer, {"step": "reveal", "room": rid, "run": doc["game"]["runId"], "round": 2})
        assert api.run(api.infra.docs.get, keys.room_doc(rid))[1]["game"]["state"]["phase"] == "finished"
        # Host can end the activity; the room returns to the lobby with ready states reset.
        assert command(hws, "room.end_activity", {"roomId": rid})["ok"]
        room_now = api.get(f"/v1/rooms/{room['code']}").json()
        assert room_now["phase"] == "lobby"
        assert [p["ready"] for p in room_now["participants"]] == [True, False]


def test_timer_lease_requeues_when_worker_dies(api: Api) -> None:
    async def scenario() -> tuple[int, int]:
        t = api.infra.services.timers
        r = api.infra.redis
        await t.schedule("noop", 0, x=1)
        # A worker claims the job and then "dies" before finishing it.
        claimed = await api.infra.scripts.claim_timers(
            keys=[keys.timers_due(), keys.timers_inflight()], args=[now_ms(), -1000, 10]
        )
        assert len(claimed) == 1
        due_after_claim = await r.zcard(keys.timers_due())
        ran = await t.run_due()  # lease already expired: the job is requeued and runs
        return int(due_after_claim), int(ran)

    due_after_claim, ran = api.run(scenario)
    assert due_after_claim == 0 and ran == 1
    assert api.run(api.infra.redis.zcard, keys.timers_inflight()) == 0
