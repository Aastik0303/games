"""Authorization (privilege escalation), moderation workflow and audit trail."""

from __future__ import annotations

import pytest

from tests.conftest import Api

ADMIN_GETS = ["/v1/admin/overview", "/v1/admin/games", "/v1/admin/reports?status=open", "/v1/admin/flags", "/v1/admin/audit"]
ADMIN_WRITES = [
    ("patch", "/v1/admin/games/missing-word", {"enabled": False}),
    ("put", "/v1/admin/flags/chat", {"enabled": False}),
    ("post", "/v1/admin/reports/rep_x/resolution", {"action": "dismiss", "note": ""}),
    ("post", "/v1/admin/rooms/room_x/close", {"reason": "test reason"}),
]


@pytest.mark.parametrize("path", ADMIN_GETS)
def test_players_cannot_read_admin_apis(api: Api, path: str) -> None:
    assert api.get(path).status_code == 401  # anonymous
    api.signup()
    r = api.get(path)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_WRITES)
def test_players_cannot_write_admin_apis(api: Api, method: str, path: str, body: dict) -> None:
    api.signup()
    assert getattr(api, method)(path, body).status_code == 403
    # Nothing changed.
    assert api.get("/v1/config/flags").json()["chat"] is True
    assert "missing-word" in {g["id"] for g in api.get("/v1/games").json()}


def test_client_cannot_grant_itself_roles(api: Api) -> None:
    s = api.signup()
    r = api.put("/v1/session/profile", {"profile": {**_profile(), "roles": ["admin"]}})
    assert r.status_code in (200, 422)
    assert api.get("/v1/session").json()["user"]["roles"] == ["player"]
    assert s["user"]["roles"] == ["player"]


def _profile() -> dict:
    from tests.conftest import profile

    return profile()


def test_moderator_scope(api: Api) -> None:
    api.signup("Mod")
    api.grant("moderator")
    assert api.get("/v1/admin/overview").status_code == 200
    assert api.get("/v1/admin/reports?status=open").status_code == 200
    assert api.get("/v1/admin/flags").status_code == 403
    assert api.put("/v1/admin/flags/chat", {"enabled": False}).status_code == 403
    assert api.get("/v1/admin/audit").status_code == 403


def test_report_review_and_audit(api: Api) -> None:
    api.signup("Host")
    room = api.post("/v1/rooms", {"activity": {"kind": "word", "gameId": "missing-word"}, "capacity": 4}).json()
    bad = api.another()
    b = bad.signup("Troll")
    bad.post(f"/v1/rooms/{room['code']}/join")
    with bad.connect() as ws:
        from tests.conftest import command

        msg_id = command(ws, "chat.send", {"roomId": room["id"], "clientMsgId": "t1", "text": "rude words"})["data"]["messageId"]
    assert (
        api.post("/v1/reports", {"targetUserId": api.get("/v1/session").json()["user"]["id"], "reason": "spam"}).status_code
        == 422
    )  # can't report yourself
    rid = api.post(
        "/v1/reports",
        {
            "targetUserId": b["user"]["id"],
            "roomId": room["id"],
            "messageId": msg_id,
            "reason": "minor_safety",
            "details": "asked for my school",
        },
    ).json()["reportId"]

    mod = api.another()
    mod.signup("Mod")
    mod.grant("moderator")
    queue = mod.get("/v1/admin/reports?status=open").json()
    report = next(r for r in queue if r["id"] == rid)
    assert report["priority"] == "high" and report["roomCode"] == room["code"]
    assert report["messageExcerpt"] == "rude words" and report["target"]["displayName"] == "Troll"
    assert mod.post(f"/v1/admin/reports/{rid}/resolution", {"action": "suspend", "note": ""}).status_code == 422
    done = mod.post(f"/v1/admin/reports/{rid}/resolution", {"action": "suspend", "note": "Repeated abuse"}).json()
    assert done["status"] == "actioned" and done["resolution"]["action"] == "suspend"
    assert mod.post(f"/v1/admin/reports/{rid}/resolution", {"action": "dismiss", "note": ""}).status_code == 409

    # Suspension revokes the session and removes them from rooms.
    assert bad.get("/v1/session").status_code == 401
    assert b["user"]["id"] not in {p["user"]["id"] for p in api.get(f"/v1/rooms/{room['code']}").json()["participants"]}

    admin = api.another()
    admin.signup("Admin")
    admin.grant("admin")
    audit = admin.get("/v1/admin/audit").json()
    assert any(
        a["action"] == "report.suspend"
        and a["actorId"] == mod.get("/v1/session").json()["user"]["id"]
        and a["reason"] == "Repeated abuse"
        for a in audit
    )
    assert rid in {r["id"] for r in mod.get("/v1/admin/reports?status=actioned").json()}


def test_admin_flags_catalog_and_room_close_are_audited(api: Api) -> None:
    api.signup("Admin")
    api.grant("admin")
    flag = api.put("/v1/admin/flags/reactions", {"enabled": False}).json()
    assert flag["key"] == "reactions" and flag["enabled"] is False
    assert api.put("/v1/admin/flags/bogus", {"enabled": False}).status_code == 404
    g = api.patch("/v1/admin/games/missing-word", {"difficulties": ["easy"]}).json()
    assert g["difficulties"] == ["easy"]
    assert api.patch("/v1/admin/games/missing-word", {"difficulties": []}).status_code == 422
    assert api.patch("/v1/admin/games/missing-word", {"difficulties": ["hard"]}).status_code == 422
    room = api.post("/v1/rooms", {"activity": {"kind": "watch"}, "capacity": 4}).json()
    assert api.post(f"/v1/admin/rooms/{room['id']}/close", {"reason": "spam room"}).status_code == 204
    assert api.get(f"/v1/rooms/{room['code']}").status_code == 404
    actions = {a["action"] for a in api.get("/v1/admin/audit").json()}
    assert {"flag.set", "catalog.update", "room.close"} <= actions


def test_overview_shape(api: Api) -> None:
    api.signup("Admin")
    api.grant("admin")
    api.post("/v1/rooms", {"activity": {"kind": "word", "gameId": "missing-word"}, "capacity": 4})
    ov = api.get("/v1/admin/overview").json()
    assert ov["metrics"]["activeRooms"] == 1 and len(ov["hourlyMatches"]) == 12
    assert {q["gameId"] for q in ov["queues"]} == {"missing-word", "riddle-relay"}
    assert ov["rooms"][0]["issues"] == [] and ov["rooms"][0]["participants"] == 1
    pulse = api.get("/v1/community/pulse").json()
    assert pulse["playersOnline"] is None  # small numbers are hidden, not shown exactly
