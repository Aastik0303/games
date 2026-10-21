from __future__ import annotations

from app.redis.client import fake_server
from tests.conftest import Api, fake_redis_only, profile


def test_health_and_version(api: Api) -> None:
    assert api.get("/v1/health/live").json() == {"status": "ok"}
    ready = api.get("/v1/health/ready")
    assert ready.status_code == 200 and ready.json()["checks"] == {"redis": "ok", "database": "ok"}
    assert api.get("/v1/version").json()["version"]


@fake_redis_only
def test_readiness_reports_redis_outage(api: Api) -> None:
    server = fake_server(api.infra.settings.redis_url.removeprefix("memory://"))
    server.connected = False
    try:
        r = api.get("/v1/health/ready")
        assert r.status_code == 503
        assert r.json()["checks"]["redis"].startswith("unavailable")
    finally:
        server.connected = True


def test_anonymous_session_is_401(api: Api) -> None:
    r = api.get("/v1/session")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_create_session_sets_httponly_cookie(api: Api) -> None:
    r = api.post("/v1/session", {"profile": profile("Ada")})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie.replace("Lax", "lax")
    body = r.json()
    assert body["user"]["displayName"] == "Ada" and body["user"]["roles"] == ["player"]
    assert body["profile"]["isMinor"] is False
    # Server never echoes anything like a birth date or token.
    assert "token" not in r.text and "birth" not in r.text
    assert api.get("/v1/session").json()["user"]["id"] == body["user"]["id"]


def test_profile_validation_errors_are_field_level(api: Api) -> None:
    bad = profile("mail me@x.com")
    r = api.post("/v1/session", {"profile": bad})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation"
    assert "profile.displayName" in r.json()["error"]["fields"]
    no_consent = profile()
    no_consent["consent"] = {"guidelinesAccepted": False, "useInterestsForMatching": False}
    assert api.post("/v1/session", {"profile": no_consent}).status_code == 422
    unknown = {"profile": profile(), "isAdmin": True}
    assert api.post("/v1/session", unknown).status_code == 422


def test_interests_dropped_without_consent(api: Api) -> None:
    s = api.signup(interests=["logic", "riddles"])
    assert s["profile"]["interests"] == []


def test_minor_defaults_are_enforced(api: Api) -> None:
    s = api.signup("Teen", "13_15")
    assert s["profile"]["isMinor"] is True
    assert api.get("/v1/me/privacy").json() == {"showOnlineStatus": True, "invitePolicy": "matched_only", "chatFilter": "strict"}
    r = api.put("/v1/me/privacy", {"showOnlineStatus": False, "invitePolicy": "anyone_with_code", "chatFilter": "standard"})
    assert r.json()["chatFilter"] == "strict" and r.json()["invitePolicy"] == "matched_only"
    # A minor can't edit their way out of the minor safety defaults.
    r = api.put("/v1/session/profile", {"profile": profile("Teen", "25_34")})
    assert r.status_code == 422


def test_csrf_header_and_origin_required(api: Api) -> None:
    r = api.client.post("/v1/session", json={"profile": profile()})
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"
    r = api.post("/v1/session", {"profile": profile()}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_cors_allows_only_configured_origin(api: Api) -> None:
    ok = api.client.options("/v1/session", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert ok.headers.get("access-control-allow-credentials") == "true"
    bad = api.client.options("/v1/session", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_oversized_body_rejected(api: Api) -> None:
    r = api.post("/v1/session", {"profile": profile(), "pad": "x" * 70_000})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "payload_too_large"


def test_refresh_and_sign_out_deletes_profile(api: Api) -> None:
    s = api.signup()
    r = api.post("/v1/session/refresh")
    assert r.status_code == 200 and r.json()["expiresAt"] >= s["expiresAt"]
    assert api.delete("/v1/session").status_code == 204
    assert api.get("/v1/session").status_code == 401

    from app.db.models import User

    async def lookup() -> object:
        async with api.infra.db() as db:
            return await db.get(User, s["user"]["id"])

    assert api.run(lookup) is None


def test_stale_cookie_is_session_expired(api: Api) -> None:
    api.signup()
    api.cookies["prism_session"] = "not-a-real-token"
    r = api.get("/v1/session")
    assert r.status_code == 401 and r.json()["error"]["code"] == "session_expired"


@fake_redis_only
def test_redis_outage_returns_controlled_503(api: Api) -> None:
    api.signup()
    server = fake_server(api.infra.settings.redis_url.removeprefix("memory://"))
    server.connected = False
    try:
        r = api.post("/v1/rooms", {"activity": {"kind": "word", "gameId": "missing-word"}, "capacity": 4})
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "unavailable"
        assert r.headers["retry-after"]
    finally:
        server.connected = True
    assert api.post("/v1/rooms", {"activity": {"kind": "word", "gameId": "missing-word"}, "capacity": 4}).status_code == 200


def test_flags_and_catalog_public(api: Api) -> None:
    flags = api.get("/v1/config/flags").json()
    assert flags == {"multiplayer": True, "watchTogether": True, "screenShare": True, "reactions": True, "chat": True}
    games = api.get("/v1/games").json()
    assert {g["id"] for g in games} == {"missing-word", "riddle-relay", "mini-grid", "wrenfield-manor"}
    assert "turnMode" not in next(g for g in games if g["id"] == "mini-grid")
    assert api.get("/v1/games/nope").status_code == 404


def test_request_id_and_security_headers(api: Api) -> None:
    r = api.get("/v1/health/live", headers={"X-Request-ID": "abcdef123456"})
    assert r.headers["x-request-id"] == "abcdef123456"
    assert r.headers["x-content-type-options"] == "nosniff"
    err = api.get("/v1/session")
    assert err.json()["error"]["requestId"]


def test_rate_limit_status_endpoint(api: Api) -> None:
    api.signup()
    r = api.get("/v1/me/rate-limits").json()
    assert r["chat"]["limit"] == 5 and r["chat"]["remaining"] == 5
