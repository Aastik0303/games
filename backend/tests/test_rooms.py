from __future__ import annotations

import asyncio
import re

from app.redis import keys
from app.services.rooms import ROOM_CODE_ALPHABET
from tests.conftest import Api

WORD_ROOM = {"activity": {"kind": "word", "gameId": "missing-word", "difficulty": "easy"}, "capacity": 3, "privacy": "private"}


def _create(api: Api, body: dict | None = None) -> dict:
    r = api.post("/v1/rooms", body or WORD_ROOM)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_room_generates_unambiguous_code(api: Api) -> None:
    api.signup("Host")
    room = _create(api)
    assert re.fullmatch(f"[{ROOM_CODE_ALPHABET}]{{8}}", room["code"])
    assert room["participants"][0]["role"] == "host" and room["version"] == 1
    # Private fields (age group, member flags, bans) never appear in the public room.
    assert "meta" not in room and "ageGroup" not in str(room)


def test_room_validation(api: Api) -> None:
    api.signup()
    too_big = {**WORD_ROOM, "capacity": 9}
    assert api.post("/v1/rooms", too_big).status_code == 422
    solo_only = {"activity": {"kind": "logic", "gameId": "mini-grid"}, "capacity": 2}
    assert api.post("/v1/rooms", solo_only).status_code == 422
    unknown = {"activity": {"kind": "word", "gameId": "nope"}, "capacity": 2}
    assert api.post("/v1/rooms", unknown).status_code == 404


def test_join_by_code_is_case_insensitive_and_idempotent(api: Api) -> None:
    api.signup("Host")
    room = _create(api)
    guest = api.another()
    guest.signup("Guest")
    code = room["code"].lower()
    formatted = f"{code[:4]}-{code[4:]}"
    joined = guest.post(f"/v1/rooms/{formatted}/join").json()
    assert len(joined["participants"]) == 2 and joined["version"] == 2
    again = guest.post(f"/v1/rooms/{room['code']}/join").json()
    assert len(again["participants"]) == 2 and again["version"] == 2


def test_invalid_and_guessed_codes_fail_safely_and_are_rate_limited(api: Api) -> None:
    api.signup()
    r = api.post("/v1/rooms/0OIL0OIL/join")  # characters outside the alphabet
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    statuses = [api.post("/v1/rooms/ABCDEFGH/join").status_code for _ in range(12)]
    assert statuses[:9] == [404] * 9
    assert 429 in statuses
    limited = api.post("/v1/rooms/ABCDEFGH/join")
    assert limited.status_code == 429 and int(limited.headers["retry-after"]) > 0


def test_full_room(api: Api) -> None:
    api.signup("Host")
    room = _create(api, {**WORD_ROOM, "capacity": 2})
    a, b = api.another(), api.another()
    a.signup("Ana")
    b.signup("Bo")
    assert a.post(f"/v1/rooms/{room['code']}/join").status_code == 200
    full = b.post(f"/v1/rooms/{room['code']}/join")
    assert full.status_code == 409 and full.json()["error"]["code"] == "room_full"


def test_capacity_race_admits_exactly_capacity(api: Api) -> None:
    """Twelve players join a 4-seat room at the same instant: exactly three get in."""
    api.signup("Host")
    room = _create(api, {**WORD_ROOM, "capacity": 4})
    players = []
    for i in range(12):
        p = api.another()
        p.signup(f"Player {i}")
        players.append(p)

    async def principals() -> list:
        return [await api.infra.services.sessions.resolve(p.cookies["prism_session"]) for p in players]

    resolved = api.run(principals)

    async def race() -> list:
        rooms = api.infra.services.rooms

        async def one(pr: object) -> str:
            try:
                await rooms.join(pr, room["code"], "1.2.3.4")
                return "ok"
            except Exception as e:
                return getattr(e, "code", "error")

        return list(await asyncio.gather(*(one(pr) for pr in resolved)))

    results = api.run(race)
    assert results.count("ok") == 3
    assert set(results) <= {"ok", "room_full"}
    final = api.get(f"/v1/rooms/{room['code']}").json()
    assert len(final["participants"]) == 4
    assert len({p["user"]["id"] for p in final["participants"]}) == 4


def test_host_leaving_transfers_host(api: Api) -> None:
    host_session = api.signup("Host")
    room = _create(api)
    guest = api.another()
    g = guest.signup("Guest")
    guest.post(f"/v1/rooms/{room['code']}/join")
    assert api.post(f"/v1/rooms/by-id/{room['id']}/leave").status_code == 204
    after = guest.get(f"/v1/rooms/{room['code']}").json()
    assert after["hostId"] == g["user"]["id"]
    assert [p["role"] for p in after["participants"]] == ["host"]
    assert host_session["user"]["id"] not in {p["user"]["id"] for p in after["participants"]}
    # Last person out closes the room and frees the code.
    assert guest.post(f"/v1/rooms/by-id/{room['id']}/leave").status_code == 204
    assert guest.get(f"/v1/rooms/{room['code']}").status_code == 404


def test_expired_room_is_not_found(api: Api) -> None:
    api.signup("Host")
    room = _create(api)

    async def expire() -> None:
        await api.infra.redis.delete(keys.room_doc(room["id"]))

    api.run(expire)
    guest = api.another()
    guest.signup("Guest")
    assert guest.post(f"/v1/rooms/{room['code']}/join").status_code == 404


def test_minors_and_adults_do_not_share_rooms(api: Api) -> None:
    api.signup("Adult")
    room = _create(api)
    teen = api.another()
    teen.signup("Teen", "16_17")
    r = teen.post(f"/v1/rooms/{room['code']}/join")
    assert r.status_code == 403


def test_matched_only_policy_blocks_code_joins(api: Api) -> None:
    api.signup("Host")
    room = _create(api)
    guest = api.another()
    guest.signup("Guest")
    guest.put("/v1/me/privacy", {"showOnlineStatus": True, "invitePolicy": "matched_only", "chatFilter": "standard"})
    r = guest.post(f"/v1/rooms/{room['code']}/join")
    assert r.status_code == 403 and "matchmaking" in r.json()["error"]["message"]


def test_blocked_user_cannot_join_blockers_room(api: Api) -> None:
    api.signup("Host")
    room = _create(api)
    pest = api.another()
    p = pest.signup("Pest")
    assert api.put(f"/v1/blocks/{p['user']['id']}").status_code == 204
    assert [u["id"] for u in api.get("/v1/blocks").json()] == [p["user"]["id"]]
    assert pest.post(f"/v1/rooms/{room['code']}/join").status_code == 403
    assert api.delete(f"/v1/blocks/{p['user']['id']}").status_code == 204
    assert pest.post(f"/v1/rooms/{room['code']}/join").status_code == 200


def test_watch_room_capacity_and_flag(api: Api) -> None:
    api.signup()
    assert api.post("/v1/rooms", {"activity": {"kind": "watch"}, "capacity": 8}).status_code == 200
    admin = api.another()
    admin.signup("Admin")
    admin.grant("admin")
    assert admin.put("/v1/admin/flags/watchTogether", {"enabled": False}).status_code == 200
    api.infra.services.flags._cache = None
    r = api.post("/v1/rooms", {"activity": {"kind": "watch"}, "capacity": 4})
    assert r.status_code == 403
