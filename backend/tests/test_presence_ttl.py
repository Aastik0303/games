"""Presence decay, host transfer, abandoned-room cleanup and retention TTLs."""

from __future__ import annotations

from app.redis import keys
from tests.conftest import Api, command, now_ms, wait_for


def _room(api: Api) -> tuple[dict, Api, dict]:
    api.signup("Host")
    room = api.post("/v1/rooms", {"activity": {"kind": "word", "gameId": "missing-word"}, "capacity": 4}).json()
    guest = api.another()
    g = guest.signup("Guest")
    guest.post(f"/v1/rooms/{room['code']}/join")
    return room, guest, g


def _expire_presence(api: Api, room_id: str) -> None:
    async def go() -> None:
        r = api.infra.redis
        members = await r.zrange(keys.room_presence(room_id), 0, -1)
        if members:
            await r.zadd(keys.room_presence(room_id), dict.fromkeys(members, now_ms() - 1))

    api.run(go)


def test_stale_presence_decays_and_host_transfers(make_app) -> None:  # type: ignore[no-untyped-def]
    api = make_app(reconnect_grace_sec=0, host_transfer_after_sec=0)
    room, guest, g = _room(api)
    with api.connect() as hws, guest.connect() as gws:
        command(hws, "room.subscribe", {"roomId": room["id"]})
        wait_for(hws, "room.snapshot")
        command(gws, "room.subscribe", {"roomId": room["id"]})
        wait_for(gws, "room.snapshot")

        # The host's heartbeats stop (e.g. laptop lid closed) but the socket isn't closed cleanly.
        async def drop_host() -> None:
            await api.infra.redis.zremrangebyscore(keys.room_presence(room["id"]), "-inf", "+inf")
            await api.infra.services.rooms.heartbeat(room["id"], g["user"]["id"], "guest-conn")

        api.run(drop_host)
        api.run(api.infra.services.rooms.sweep)
        ev = wait_for(gws, "presence.changed")
        assert ev["payload"]["userId"] == room["hostId"] and ev["payload"]["connection"] == "reconnecting"
        api.run(api.infra.services.rooms.sweep)
        api.run(api.infra.services.rooms.sweep)
        after = guest.get(f"/v1/rooms/{room['code']}").json()
        host = next(p for p in after["participants"] if p["user"]["id"] == room["hostId"])
        assert host["connection"] == "offline"
        assert after["hostId"] == g["user"]["id"]  # online guest took over as host


def test_temporary_disconnect_keeps_the_room(api: Api) -> None:
    room, guest, _ = _room(api)
    with guest.connect() as ws:
        command(ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(ws, "room.snapshot")
    api.run(api.infra.services.rooms.sweep)
    r = guest.get(f"/v1/rooms/{room['code']}").json()
    assert r["phase"] == "lobby" and len(r["participants"]) == 2


def test_abandoned_room_is_closed(make_app) -> None:  # type: ignore[no-untyped-def]
    api = make_app(reconnect_grace_sec=0, room_abandon_after_sec=0)
    room, _, _ = _room(api)

    async def age() -> None:
        def fn(d: dict) -> None:
            for p in d["room"]["participants"]:
                p["connection"] = "offline"
            d["meta"]["lastActivity"] = 0

        await api.infra.services.rooms.mutate(room["id"], fn)

    api.run(age)
    api.run(api.infra.services.rooms.sweep)
    assert api.get(f"/v1/rooms/{room['code']}").status_code == 404
    assert api.run(api.infra.redis.zcard, keys.rooms_active()) == 0
    assert api.run(api.infra.redis.get, keys.room_code(room["code"])) is None


def test_ephemeral_keys_all_have_ttls(api: Api) -> None:
    room, guest, _ = _room(api)
    solo = api.post("/v1/solo/sessions", {"gameId": "missing-word", "difficulty": "easy"}).json()
    guest.post(
        "/v1/matchmaking/tickets",
        {"gameId": "riddle-relay", "groupSize": 2, "difficulty": "easy", "language": "en", "interests": []},
    )
    api.post("/v1/realtime/tickets")
    with api.connect() as ws:
        command(ws, "room.subscribe", {"roomId": room["id"]})
        command(ws, "chat.send", {"roomId": room["id"], "clientMsgId": "ttl1", "text": "hello"})

    async def ttls() -> dict[str, int]:
        r = api.infra.redis
        out = {}
        for k in await r.keys("prism:v1:*"):
            out[k] = int(await r.pttl(k))
        return out

    found = api.run(ttls)
    # Global indexes are pruned by the sweeper/matcher instead of expiring.
    permanent = {keys.rooms_active(), keys.mm_segments(), keys.online_users(), keys.timers_due(), keys.timers_inflight()}
    no_ttl = sorted(k for k, ttl in found.items() if ttl < 0 and k not in permanent)
    assert no_ttl == [], no_ttl
    assert any(k.startswith(keys.solo_doc(solo["id"])) for k in found)
    session_ttl = max(t for k, t in found.items() if k.startswith("prism:v1:sess:"))
    assert 0 < session_ttl <= api.infra.settings.session_ttl_sec * 1000
    ws_ticket_ttls = [t for k, t in found.items() if k.startswith("prism:v1:wst:")]
    assert all(0 < t <= 30_000 for t in ws_ticket_ttls)
