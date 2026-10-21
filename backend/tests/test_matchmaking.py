"""Matchmaking: exactly-once matching under concurrency, crash recovery, safety segmentation."""

from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor

from app.redis import keys
from app.services.matchmaking import form_groups
from tests.conftest import Api, command, now_ms, wait_for

CRIT = {"gameId": "missing-word", "groupSize": 2, "difficulty": "easy", "language": "en", "interests": []}


def _t(id_: str, user: str, enq: int, difficulty: str = "easy", widened: str = "0", interests: list[str] | None = None) -> dict:
    return {
        "id": id_,
        "user": user,
        "enq": str(enq),
        "difficulty": difficulty,
        "widened": widened,
        "interests": json.dumps(interests or []),
    }


def test_form_groups_oldest_first_and_safety_rules() -> None:
    a, b, c, d = _t("a", "ua", 1), _t("b", "ub", 2), _t("c", "uc", 3), _t("d", "ud", 4)
    assert [[t["id"] for t in g] for g in form_groups([d, c, b, a], 2, set())] == [["a", "b"], ["c", "d"]]
    # A blocked pair is never grouped; the next compatible ticket is used instead.
    groups = form_groups([a, b, c], 2, {frozenset(("ua", "ub"))})
    assert [[t["id"] for t in g] for g in groups] == [["a", "c"]]
    # Two tickets from the same user never form a group.
    assert form_groups([_t("x", "u1", 1), _t("y", "u1", 2)], 2, set()) == []
    # Difficulty must match until both tickets have widened.
    hard = _t("h", "uh", 2, "medium")
    assert form_groups([a, hard], 2, set()) == []
    assert len(form_groups([_t("a", "ua", 1, widened="1"), _t("h", "uh", 2, "medium", "1")], 2, set())) == 1
    # Within the same wait window, shared interests win the tie.
    anchor = _t("a", "ua", 1000, interests=["logic"])
    plain = _t("p", "up", 1001)
    fan = _t("f", "uf", 1002, interests=["logic"])
    assert [t["id"] for t in form_groups([anchor, plain, fan], 2, set())[0]] == ["a", "f"]


def _players(api: Api, n: int, age_band: str = "25_34") -> list[Api]:
    out = []
    for i in range(n):
        p = api.another()
        p.signup(f"Player {i}", age_band)
        out.append(p)
    return out


def test_enqueue_match_and_notify(api: Api) -> None:
    a, b = _players(api, 2)
    with a.connect() as ws_a:
        ta = a.post("/v1/matchmaking/tickets", CRIT).json()
        assert ta["criteria"]["gameId"] == "missing-word"
        assert command(ws_a, "matchmaking.watch", {"ticketId": ta["ticketId"]})["ok"]
        assert wait_for(ws_a, "matchmaking.status")["payload"]["phase"] == "queued"
        tb = b.post("/v1/matchmaking/tickets", CRIT).json()
        assert api.run(api.infra.services.matchmaking.match_once) == 1
        matched = wait_for(ws_a, "matchmaking.matched")["payload"]
    assert matched["ticketId"] == ta["ticketId"]
    code = matched["roomCode"]
    room = b.post(f"/v1/rooms/{code}/join").json()  # idempotent: already a member
    assert len(room["participants"]) == 2 and room["capacity"] == 2
    assert b.get(f"/v1/matchmaking/tickets/{tb['ticketId']}").json() == {
        "ticketId": tb["ticketId"],
        "phase": "matched",
        "roomCode": code,
    }


def test_validation_and_feature_flag(api: Api) -> None:
    (p,) = _players(api, 1)
    assert p.post("/v1/matchmaking/tickets", {**CRIT, "groupSize": 5}).status_code == 422
    assert p.post("/v1/matchmaking/tickets", {**CRIT, "gameId": "mini-grid"}).status_code == 422
    admin = api.another()
    admin.signup("Admin")
    admin.grant("admin")
    admin.put("/v1/admin/flags/multiplayer", {"enabled": False})
    api.infra.services.flags._cache = None
    assert p.post("/v1/matchmaking/tickets", CRIT).status_code == 403


def test_reenqueue_replaces_ticket_and_cancel_is_idempotent(api: Api) -> None:
    (p,) = _players(api, 1)
    t1 = p.post("/v1/matchmaking/tickets", CRIT).json()["ticketId"]
    t2 = p.post("/v1/matchmaking/tickets", CRIT).json()["ticketId"]
    assert p.get(f"/v1/matchmaking/tickets/{t1}").json()["phase"] == "cancelled"
    assert p.delete(f"/v1/matchmaking/tickets/{t2}").status_code == 204
    assert p.delete(f"/v1/matchmaking/tickets/{t2}").status_code == 204
    assert p.get(f"/v1/matchmaking/tickets/{t2}").json()["phase"] == "cancelled"
    other = api.another()
    other.signup("Other")
    assert other.get(f"/v1/matchmaking/tickets/{t2}").status_code == 404


def test_concurrent_enqueue_cancel_never_matches_cancelled(api: Api) -> None:
    players = _players(api, 6)
    tickets = [p.post("/v1/matchmaking/tickets", CRIT).json()["ticketId"] for p in players]
    principals = [api.run(api.infra.services.sessions.resolve, p.cookies["prism_session"]) for p in players]
    mm = api.infra.services.matchmaking

    async def race() -> None:
        await asyncio.gather(
            mm.match_once(),
            mm.match_once(),
            *(mm.cancel(principals[i], tickets[i]) for i in (0, 2, 4)),
        )

    api.run(race)
    statuses = [p.get(f"/v1/matchmaking/tickets/{t}").json()["phase"] for p, t in zip(players, tickets, strict=True)]
    for i in (0, 2, 4):
        assert statuses[i] in ("cancelled", "matched")
    matched = [i for i, s in enumerate(statuses) if s == "matched"]
    assert len(matched) % 2 == 0
    # Every matched ticket's room contains exactly its group, and nobody is in two rooms.
    seen: set[str] = set()
    for i in matched:
        code = players[i].get(f"/v1/matchmaking/tickets/{tickets[i]}").json()["roomCode"]
        ids = {p["user"]["id"] for p in players[i].get(f"/v1/rooms/{code}").json()["participants"]}
        seen |= ids
    assert len(seen) == len(matched)


def test_two_workers_cannot_claim_the_same_players(make_app) -> None:  # type: ignore[no-untyped-def]
    w1 = make_app()
    w2 = make_app()
    players = _players(w1, 4)
    for p in players:
        assert p.post("/v1/matchmaking/tickets", CRIT).status_code == 200

    async def burst(api: Api) -> int:
        made = await asyncio.gather(*(api.infra.services.matchmaking.match_once() for _ in range(5)))
        return sum(made)

    # Both workers run 5 matchers each, at the same time, on separate threads and event loops.
    with ThreadPoolExecutor(2) as pool:
        made = sum(pool.map(lambda w: w.run(burst, w), [w1, w2]))
    assert made == 2  # 4 players -> exactly 2 rooms, however many matchers raced
    rooms = w1.run(w1.infra.redis.zcard, keys.rooms_active())
    assert rooms == 2


def test_worker_death_mid_match_releases_or_finishes(api: Api) -> None:
    a, b = _players(api, 2)
    ta = a.post("/v1/matchmaking/tickets", CRIT).json()["ticketId"]
    tb = b.post("/v1/matchmaking/tickets", CRIT).json()["ticketId"]
    segment = "missing-word:en:2:adult"

    async def claim_and_die(op: str) -> None:
        ok = await api.infra.scripts.claim_tickets(
            keys=[keys.mm_queue(segment), keys.mm_ticket(segment, ta), keys.mm_ticket(segment, tb)], args=[op, now_ms(), ta, tb]
        )
        assert ok == 1
        await api.infra.redis.hset(keys.mm_claims(segment), op, json.dumps({"tickets": [ta, tb], "at": 0}))

    # Case 1: died before creating the room -> tickets go back to the queue, nobody is told "matched".
    api.run(claim_and_die, "mop_dead1")
    assert a.get(f"/v1/matchmaking/tickets/{ta}").json()["phase"] == "searching"  # claimed, not matched
    assert api.run(api.infra.services.matchmaking.recover_claims) == 1
    assert api.run(api.infra.redis.zcard, keys.mm_queue(segment)) == 2
    # Case 2: died after creating the room -> recovery finishes the same match (no second room).
    api.run(claim_and_die, "mop_dead2")

    ua = a.get("/v1/session").json()["user"]["id"]
    ub = b.get("/v1/session").json()["user"]["id"]

    async def create_then_die() -> None:
        mm = api.infra.services.matchmaking
        group = [{"id": ta, "user": ua, "difficulty": "easy"}, {"id": tb, "user": ub, "difficulty": "easy"}]
        original = mm._finish

        async def crash(*_: object) -> None:
            raise RuntimeError("worker died")

        mm._finish = crash
        try:
            await mm._create_room(segment, "mop_dead2", group)
        except RuntimeError:
            pass
        finally:
            mm._finish = original

    api.run(create_then_die)
    assert api.run(api.infra.redis.zcard, keys.rooms_active()) == 1
    assert api.run(api.infra.services.matchmaking.recover_claims) == 1
    status = a.get(f"/v1/matchmaking/tickets/{ta}").json()
    assert status["phase"] == "matched"
    assert api.run(api.infra.redis.zcard, keys.rooms_active()) == 1
    assert b.get(f"/v1/matchmaking/tickets/{tb}").json()["roomCode"] == status["roomCode"]


def test_minors_only_match_minors(api: Api) -> None:
    (adult,) = _players(api, 1)
    (teen,) = _players(api, 1, "13_15")
    adult.post("/v1/matchmaking/tickets", CRIT)
    teen.post("/v1/matchmaking/tickets", CRIT)
    assert api.run(api.infra.services.matchmaking.match_once) == 0
    (teen2,) = _players(api, 1, "16_17")
    teen2.post("/v1/matchmaking/tickets", CRIT)
    assert api.run(api.infra.services.matchmaking.match_once) == 1
    t = teen.get("/v1/session").json()["user"]["id"]
    t2 = teen2.get("/v1/session").json()["user"]["id"]
    room_code = api.run(api.infra.redis.zrange, keys.rooms_active(), 0, -1)
    assert len(room_code) == 1
    doc = api.run(api.infra.services.rooms.load, room_code[0])
    assert {p["user"]["id"] for p in doc["room"]["participants"]} == {t, t2}


def test_blocked_players_are_not_rematched(api: Api) -> None:
    x, y = _players(api, 2)
    y_id = y.get("/v1/session").json()["user"]["id"]
    x.put(f"/v1/blocks/{y_id}")
    x.post("/v1/matchmaking/tickets", CRIT)
    y.post("/v1/matchmaking/tickets", CRIT)
    assert api.run(api.infra.services.matchmaking.match_once) == 0
    (z,) = _players(api, 1)
    z.post("/v1/matchmaking/tickets", CRIT)
    assert api.run(api.infra.services.matchmaking.match_once) == 1
    room_id = api.run(api.infra.redis.zrange, keys.rooms_active(), 0, -1)[0]
    ids = {p["user"]["id"] for p in api.run(api.infra.services.rooms.load, room_id)["room"]["participants"]}
    assert z.get("/v1/session").json()["user"]["id"] in ids
    assert not {x.get("/v1/session").json()["user"]["id"], y_id} <= ids


def test_ticket_expiry_and_widening(make_app) -> None:  # type: ignore[no-untyped-def]
    api = make_app(match_ticket_ttl_sec=1, match_widen_after_sec=0)
    (p,) = _players(api, 1)
    with p.connect() as ws:
        t = p.post("/v1/matchmaking/tickets", CRIT).json()["ticketId"]
        command(ws, "matchmaking.watch", {"ticketId": t})
        api.run(api.infra.services.matchmaking.match_once)
        phases = []
        for _ in range(4):
            phases.append(wait_for(ws, "matchmaking.status")["payload"]["phase"])
            if phases[-1] == "widening":
                break
        assert "widening" in phases
        import time

        time.sleep(1.1)
        api.run(api.infra.services.matchmaking.match_once)
        assert wait_for(ws, "matchmaking.status")["payload"]["phase"] == "expired"
    assert p.get(f"/v1/matchmaking/tickets/{t}").json()["phase"] == "expired"
