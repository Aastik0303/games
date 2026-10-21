from __future__ import annotations

import uuid

import pytest
from starlette.websockets import WebSocketDisconnect

from app.redis import keys
from tests.conftest import ORIGIN, Api, command, wait_for

ROOM = {"activity": {"kind": "word", "gameId": "missing-word", "difficulty": "easy"}, "capacity": 4}


def _room_with_guest(api: Api) -> tuple[dict, Api, dict]:
    api.signup("Host")
    room = api.post("/v1/rooms", ROOM).json()
    guest = api.another()
    g = guest.signup("Guest")
    guest.post(f"/v1/rooms/{room['code']}/join")
    return room, guest, g


def test_invalid_ticket_closes_with_4401(api: Api) -> None:
    with api.client.websocket_connect("/v1/ws?ticket=bogus", headers={"Origin": ORIGIN}) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == 4401


def test_ticket_is_single_use(api: Api) -> None:
    api.signup()
    url = api.ws_url()
    with api.client.websocket_connect(url, headers={"Origin": ORIGIN}):
        pass
    with api.client.websocket_connect(url, headers={"Origin": ORIGIN}) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == 4401


def test_foreign_origin_refused(api: Api) -> None:
    api.signup()
    with pytest.raises(WebSocketDisconnect):
        with api.client.websocket_connect(api.ws_url(), headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_malformed_and_invalid_messages(api: Api) -> None:
    room, _, _ = _room_with_guest(api)
    with api.connect() as ws:
        ws.send_text("not json")
        assert wait_for(ws, "error")["payload"]["code"] == "validation"
        ws.send_json({"id": "x1", "type": "room.start"})  # missing payload
        assert ws.receive_json()["payload"] == {
            "replyTo": "x1",
            "ok": False,
            "error": {"code": "validation", "message": "Malformed command"},
        }
        bad = command(ws, "nope.command", {})
        assert bad["error"]["code"] == "validation"
        extra = command(ws, "room.set_ready", {"roomId": room["id"], "ready": True, "admin": True})
        assert extra["error"]["code"] == "validation"
        long_chat = command(ws, "chat.send", {"roomId": room["id"], "clientMsgId": "c1", "text": "x" * 301})
        assert long_chat["error"]["code"] == "validation"


def test_oversized_frame_closes_socket(api: Api) -> None:
    api.signup()
    with api.connect() as ws:
        ws.send_text("x" * 20_000)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == 1009


def test_non_member_cannot_subscribe(api: Api) -> None:
    room, _, _ = _room_with_guest(api)
    outsider = api.another()
    outsider.signup("Outsider")
    with outsider.connect() as ws:
        ack = command(ws, "room.subscribe", {"roomId": room["id"]})
        assert ack["ok"] is False and ack["error"]["code"] == "forbidden"


def test_subscribe_snapshot_and_host_only_commands(api: Api) -> None:
    room, guest, g = _room_with_guest(api)
    with api.connect() as host_ws, guest.connect() as guest_ws:
        assert command(host_ws, "room.subscribe", {"roomId": room["id"]})["ok"]
        snap = wait_for(host_ws, "room.snapshot")
        assert snap["roomId"] == room["id"] and isinstance(snap["seq"], int)
        assert snap["payload"]["room"]["code"] == room["code"] and snap["payload"]["game"] is None
        assert command(guest_ws, "room.subscribe", {"roomId": room["id"]})["ok"]
        wait_for(guest_ws, "room.snapshot")

        denied = command(guest_ws, "room.start", {"roomId": room["id"]})
        assert denied["error"] == {"code": "forbidden", "message": "Only the host can start"}
        kick = command(guest_ws, "room.kick", {"roomId": room["id"], "userId": room["hostId"]})
        assert kick["error"]["code"] == "forbidden"
        not_ready = command(host_ws, "room.start", {"roomId": room["id"]})
        assert not_ready["error"]["code"] == "conflict"

        assert command(guest_ws, "room.set_ready", {"roomId": room["id"], "ready": True})["ok"]
        updated = wait_for(host_ws, "room.updated")
        assert any(p["ready"] for p in updated["payload"]["room"]["participants"] if p["user"]["id"] == g["user"]["id"])
        assert command(host_ws, "room.start", {"roomId": room["id"]})["ok"]
        state = wait_for(guest_ws, "game.state")["payload"]["state"]
        assert state["phase"] == "countdown" and state["puzzle"] is None


def test_seq_increases_and_chat_is_idempotent(api: Api) -> None:
    room, guest, _ = _room_with_guest(api)
    with api.connect() as host_ws, guest.connect() as guest_ws:
        command(host_ws, "room.subscribe", {"roomId": room["id"]})
        base = wait_for(host_ws, "room.snapshot")["seq"]
        command(guest_ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(guest_ws, "room.snapshot")
        first = command(guest_ws, "chat.send", {"roomId": room["id"], "clientMsgId": "m-1", "text": "hello"})
        retry = command(guest_ws, "chat.send", {"roomId": room["id"], "clientMsgId": "m-1", "text": "hello"})
        assert first["ok"] and retry["data"]["messageId"] == first["data"]["messageId"]
        msg = wait_for(host_ws, "chat.message")
        assert msg["seq"] > base and msg["payload"]["message"]["text"] == "hello"
        assert msg["payload"]["message"]["author"].keys() == {"id", "displayName", "avatarHue", "isBot"}
    history = api.run(api.infra.services.rooms.chat_history, room["id"])
    assert sum(1 for m in history if m.get("clientMsgId") == "m-1") == 1


def test_duplicate_command_id_has_one_effect(api: Api) -> None:
    room, guest, _ = _room_with_guest(api)
    with api.connect() as ws:
        command(ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(ws, "room.snapshot")
        cid = uuid.uuid4().hex
        a = command(ws, "reaction.send", {"roomId": room["id"], "reaction": "🔥"}, cmd_id=cid)
        b = command(ws, "reaction.send", {"roomId": room["id"], "reaction": "🔥"}, cmd_id=cid)
        assert a == b and a["ok"]
    # Same command id from a *new* socket (client retry after reconnect) is also deduplicated.
    with api.connect() as ws2:
        c = command(ws2, "reaction.send", {"roomId": room["id"], "reaction": "🔥"}, cmd_id=cid)
        assert c["ok"] and c["replyTo"] == cid
    usage = api.get("/v1/me/rate-limits").json()["reaction"]
    assert usage["remaining"] == usage["limit"] - 1


def test_minor_room_chat_strips_links(api: Api) -> None:
    api.signup("Teen One", "13_15")
    room = api.post("/v1/rooms", ROOM).json()
    with api.connect() as ws:
        command(ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(ws, "room.snapshot")
        command(ws, "chat.send", {"roomId": room["id"], "clientMsgId": "l1", "text": "see https://x.example/a"})
        assert wait_for(ws, "chat.message")["payload"]["message"]["text"] == "see [link removed]"


def test_chat_rate_limit(api: Api) -> None:
    room, _, _ = _room_with_guest(api)
    with api.connect() as ws:
        command(ws, "room.subscribe", {"roomId": room["id"]})
        acks = [command(ws, "chat.send", {"roomId": room["id"], "clientMsgId": f"r{i}", "text": "hi"}) for i in range(6)]
    assert [a["ok"] for a in acks] == [True] * 5 + [False]
    assert acks[5]["error"]["code"] == "rate_limited"


def test_blocked_author_hidden_from_blocker(api: Api) -> None:
    room, guest, g = _room_with_guest(api)
    api.put(f"/v1/blocks/{g['user']['id']}")
    with api.connect() as host_ws, guest.connect() as guest_ws:
        command(host_ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(host_ws, "room.snapshot")
        command(guest_ws, "room.subscribe", {"roomId": room["id"]})
        command(guest_ws, "chat.send", {"roomId": room["id"], "clientMsgId": "b1", "text": "from guest"})
        command(guest_ws, "reaction.send", {"roomId": room["id"], "reaction": "🎉"})
        # The host gets the reaction but never the blocked user's chat message.
        for _ in range(20):
            frame = host_ws.receive_json()
            assert not (frame["type"] == "chat.message" and frame["payload"]["message"]["text"] == "from guest")
            if frame["type"] == "reaction":
                break


def test_kick_removes_and_bans(api: Api) -> None:
    room, guest, g = _room_with_guest(api)
    with api.connect() as host_ws, guest.connect() as guest_ws:
        command(host_ws, "room.subscribe", {"roomId": room["id"]})
        command(guest_ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(guest_ws, "room.snapshot")
        assert command(host_ws, "room.kick", {"roomId": room["id"], "userId": g["user"]["id"]})["ok"]
        removed = wait_for(guest_ws, "room.removed")
        assert removed["payload"] == {"roomId": room["id"], "reason": "kicked"}
        retry = command(guest_ws, "chat.send", {"roomId": room["id"], "clientMsgId": "k1", "text": "hi"})
        assert retry["error"]["code"] == "forbidden"
    assert guest.post(f"/v1/rooms/{room['code']}/join").status_code == 403


def test_reconnect_gets_fresh_snapshot_and_presence(api: Api) -> None:
    room, guest, g = _room_with_guest(api)
    with api.connect() as host_ws:
        command(host_ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(host_ws, "room.snapshot")
        with guest.connect() as guest_ws:
            command(guest_ws, "room.subscribe", {"roomId": room["id"]})
            wait_for(guest_ws, "room.snapshot")
        gone = wait_for(host_ws, "presence.changed")
        assert gone["payload"] == {"roomId": room["id"], "userId": g["user"]["id"], "connection": "reconnecting"}
        with guest.connect() as guest_ws:
            ack = command(guest_ws, "room.subscribe", {"roomId": room["id"], "lastSeq": 1})
            assert ack["ok"]
            snap = wait_for(guest_ws, "room.snapshot")
            me = next(p for p in snap["payload"]["room"]["participants"] if p["user"]["id"] == g["user"]["id"])
            assert me["connection"] == "online"
        back = wait_for(host_ws, "presence.changed")
        assert back["payload"]["connection"] == "online"


def test_session_revocation_closes_socket(api: Api) -> None:
    api.signup()
    with api.connect() as ws:
        api.delete("/v1/session")
        with pytest.raises(WebSocketDisconnect) as exc:
            for _ in range(10):
                ws.receive_json()
    assert exc.value.code == 4401


def test_watch_together_host_controls(api: Api) -> None:
    api.signup("Host")
    room = api.post("/v1/rooms", {"activity": {"kind": "watch"}, "capacity": 4}).json()
    guest = api.another()
    guest.signup("Guest")
    guest.post(f"/v1/rooms/{room['code']}/join")
    url = "https://upload.wikimedia.org/wikipedia/commons/x/clip.webm"
    with api.connect() as host_ws, guest.connect() as guest_ws:
        command(host_ws, "room.subscribe", {"roomId": room["id"]})
        command(guest_ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(guest_ws, "room.snapshot")
        assert command(host_ws, "room.start", {"roomId": room["id"]})["ok"]
        assert wait_for(guest_ws, "watch.state")["payload"]["state"]["status"] == "idle"
        bad = command(
            host_ws,
            "watch.set_source",
            {"roomId": room["id"], "source": {"kind": "url", "url": "https://evil.example/x.mp4", "title": "x"}},
        )
        assert bad["error"]["code"] == "validation"
        assert command(
            host_ws, "watch.set_source", {"roomId": room["id"], "source": {"kind": "url", "url": url, "title": "Clip"}}
        )["ok"]
        assert command(host_ws, "watch.control", {"roomId": room["id"], "action": "play", "positionSec": 12.5})["ok"]
        st = None
        for _ in range(10):
            st = wait_for(guest_ws, "watch.state")["payload"]["state"]
            if st["status"] == "playing":
                break
        assert st and st["positionSec"] == 12.5 and st["source"]["url"] == url and st["updatedAt"]
        denied = command(guest_ws, "watch.control", {"roomId": room["id"], "action": "pause", "positionSec": 13})
        assert denied["error"]["code"] == "forbidden"


def test_presence_keys_cleaned_on_disconnect(api: Api) -> None:
    room, _, _ = _room_with_guest(api)
    with api.connect() as ws:
        command(ws, "room.subscribe", {"roomId": room["id"]})
        wait_for(ws, "room.snapshot")
        assert api.run(api.infra.redis.zcard, keys.room_presence(room["id"])) == 1
    import time

    for _ in range(50):
        if api.run(api.infra.redis.zcard, keys.room_presence(room["id"])) == 0:
            break
        time.sleep(0.02)
    assert api.run(api.infra.redis.zcard, keys.room_presence(room["id"])) == 0
