"""Two app instances ("workers") sharing Redis and the database."""

from __future__ import annotations

import time

import pytest

from app.redis.client import fake_server
from tests.conftest import Api, command, fake_redis_only, wait_for


@pytest.fixture
def workers(make_app) -> tuple[Api, Api]:  # type: ignore[no-untyped-def]
    return make_app(), make_app()


def test_room_events_fan_out_across_workers(workers: tuple[Api, Api]) -> None:
    w1, w2 = workers
    w1.signup("Host")
    room = w1.post("/v1/rooms", {"activity": {"kind": "word", "gameId": "missing-word"}, "capacity": 4}).json()
    guest = Api(w2.app, w2.client)  # this browser talks to worker 2
    guest.signup("Guest")
    assert guest.post(f"/v1/rooms/{room['code']}/join").status_code == 200
    with w1.connect() as ws1, guest.connect() as ws2:
        command(ws1, "room.subscribe", {"roomId": room["id"]})
        wait_for(ws1, "room.snapshot")
        command(ws2, "room.subscribe", {"roomId": room["id"]})
        wait_for(ws2, "room.snapshot")
        command(ws2, "chat.send", {"roomId": room["id"], "clientMsgId": "x1", "text": "from worker 2"})
        got = wait_for(ws1, "chat.message")
        assert got["payload"]["message"]["text"] == "from worker 2"
        command(ws1, "room.set_ready", {"roomId": room["id"], "ready": False})
        assert wait_for(ws2, "room.updated")["roomId"] == room["id"]


@fake_redis_only
def test_listener_recovers_after_redis_outage_and_resyncs(workers: tuple[Api, Api]) -> None:
    w1, _ = workers
    w1.signup("Host")
    room = w1.post("/v1/rooms", {"activity": {"kind": "word", "gameId": "missing-word"}, "capacity": 4}).json()
    with w1.connect() as ws:
        command(ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(ws, "room.snapshot")
        server = fake_server(w1.infra.settings.redis_url.removeprefix("memory://"))
        server.connected = False
        failed = command(ws, "room.set_ready", {"roomId": room["id"], "ready": True})
        assert failed["ok"] is False and failed["error"]["code"] == "server"  # controlled error, no false success
        hub = w1.app.state.hub
        deadline = time.monotonic() + 5
        while hub.connected.is_set() and time.monotonic() < deadline:  # listener notices the outage
            time.sleep(0.05)
        assert not hub.connected.is_set()
        server.connected = True
        # After reconnecting, the worker pushes a fresh snapshot so nothing missed stays missed.
        snap = wait_for(ws, "room.snapshot", limit=200)
        assert snap["payload"]["room"]["id"] == room["id"]
        assert command(ws, "room.set_ready", {"roomId": room["id"], "ready": True})["ok"]
