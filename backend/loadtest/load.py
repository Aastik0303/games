"""Load scenarios for a running Prism API.

    PRISM_TRUST_PROXY_HEADERS=true uvicorn app.main:app_factory --factory --port 8000
    python loadtest/load.py --base http://localhost:8000 --users 200

Each simulated user gets its own X-Forwarded-For address so per-IP limits
(sign-up, socket connects) behave as they would for real, distinct clients.
Only run this against an environment where the server is configured to trust
that header (a test environment). Results are printed as JSON; nothing is invented —
every number comes from timings measured in this run.

Scenarios
1. matchmaking burst:   N users enqueue at once (group size 2). Measures enqueue
   latency and time-to-"matched" event, and checks every user is matched exactly once.
2. concurrent joins:    rooms with capacity 4, 3x more joiners than seats racing.
   Checks no room exceeds capacity; measures join latency.
3. websocket fanout:    every room member sends one chat message; measures
   publish -> delivery latency at the other members.
4. reconnect storm:     every socket drops and reconnects at once; measures time
   to a fresh room.snapshot.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
import uuid
from typing import Any

import httpx
from websockets.asyncio.client import ClientConnection, connect

ORIGIN = "http://localhost:3000"


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    return round(s[min(len(s) - 1, round(p / 100 * (len(s) - 1)))] * 1000, 1)


def summary(values: list[float]) -> dict[str, Any]:
    return {
        "n": len(values),
        "p50_ms": pct(values, 50),
        "p95_ms": pct(values, 95),
        "p99_ms": pct(values, 99),
        "max_ms": pct(values, 100),
        "mean_ms": round(statistics.mean(values) * 1000, 1) if values else None,
    }


class User:
    def __init__(self, base: str, n: int) -> None:
        self.ip = f"10.{(n >> 16) & 255}.{(n >> 8) & 255}.{n & 255}"
        self.http = httpx.AsyncClient(
            base_url=base, timeout=30, headers={"X-Prism-Client": "web", "Origin": ORIGIN, "X-Forwarded-For": self.ip}
        )
        self.name = f"Load {n}"
        self.id = ""
        self.ws: ClientConnection | None = None
        self.inbox: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.reader: asyncio.Task[None] | None = None

    async def signup(self) -> None:
        r = await self.http.post(
            "/v1/session",
            json={
                "profile": {
                    "displayName": self.name,
                    "ageBand": "25_34",
                    "language": "en",
                    "interests": [],
                    "consent": {"guidelinesAccepted": True, "useInterestsForMatching": False},
                }
            },
        )
        r.raise_for_status()
        self.id = r.json()["user"]["id"]

    async def open_ws(self) -> None:
        r = await self.http.post("/v1/realtime/tickets")
        r.raise_for_status()
        self.ws = await connect(
            r.json()["url"],
            origin=ORIGIN,
            additional_headers={"X-Forwarded-For": self.ip},  # type: ignore[arg-type]
            max_size=2**20,
        )
        self.reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        assert self.ws
        try:
            async for raw in self.ws:
                ev = json.loads(raw)
                ev["_rx"] = time.perf_counter()
                await self.inbox.put(ev)
        except Exception:  # noqa: S110 - socket closed
            pass

    async def send(self, type_: str, payload: dict[str, Any]) -> str:
        assert self.ws
        cid = uuid.uuid4().hex
        await self.ws.send(json.dumps({"id": cid, "type": type_, "payload": payload}))
        return cid

    async def wait(self, pred: Any, within: float = 30) -> dict[str, Any]:
        deadline = time.perf_counter() + within
        while True:
            ev = await asyncio.wait_for(self.inbox.get(), max(0.01, deadline - time.perf_counter()))
            if pred(ev):
                return ev

    async def close_ws(self) -> None:
        if self.ws:
            await self.ws.close()
        if self.reader:
            await asyncio.gather(self.reader, return_exceptions=True)
        self.ws = None
        self.inbox = asyncio.Queue()


async def matchmaking_burst(users: list[User]) -> dict[str, Any]:
    await asyncio.gather(*(u.open_ws() for u in users))
    enqueue_lat: list[float] = []
    match_lat: list[float] = []
    codes: dict[str, str] = {}
    crit = {"gameId": "missing-word", "groupSize": 2, "difficulty": "easy", "language": "en", "interests": []}

    async def one(u: User) -> None:
        t0 = time.perf_counter()
        r = await u.http.post("/v1/matchmaking/tickets", json=crit)
        r.raise_for_status()
        enqueue_lat.append(time.perf_counter() - t0)
        ticket = r.json()["ticketId"]
        await u.send("matchmaking.watch", {"ticketId": ticket})
        ev = await u.wait(lambda e: e["type"] == "matchmaking.matched" and e["payload"]["ticketId"] == ticket, 60)
        match_lat.append(ev["_rx"] - t0)
        codes[u.id] = ev["payload"]["roomCode"]

    t = time.perf_counter()
    results = await asyncio.gather(*(one(u) for u in users), return_exceptions=True)
    errors = [repr(r) for r in results if isinstance(r, Exception)]
    by_room: dict[str, int] = {}
    for code in codes.values():
        by_room[code] = by_room.get(code, 0) + 1
    return {
        "users": len(users),
        "matched": len(codes),
        "rooms": len(by_room),
        "rooms_with_wrong_size": sum(1 for n in by_room.values() if n != 2),
        "wall_s": round(time.perf_counter() - t, 2),
        "enqueue": summary(enqueue_lat),
        "time_to_matched": summary(match_lat),
        "errors": errors[:5],
        "error_count": len(errors),
    }


async def concurrent_joins(users: list[User], rooms: int) -> dict[str, Any]:
    hosts, joiners = users[:rooms], users[rooms:]
    created = []
    for h in hosts:
        r = await h.http.post("/v1/rooms", json={"activity": {"kind": "word", "gameId": "missing-word"}, "capacity": 4})
        r.raise_for_status()
        created.append(r.json())
    lat: list[float] = []
    outcome: dict[str, int] = {}

    async def join(u: User, room: dict[str, Any]) -> None:
        t0 = time.perf_counter()
        r = await u.http.post(f"/v1/rooms/{room['code']}/join")
        lat.append(time.perf_counter() - t0)
        key = "ok" if r.status_code == 200 else r.json()["error"]["code"]
        outcome[key] = outcome.get(key, 0) + 1

    await asyncio.gather(*(join(u, created[i % rooms]) for i, u in enumerate(joiners)))
    sizes = []
    for room in created:
        r = await hosts[0].http.get(f"/v1/rooms/{room['code']}")
        sizes.append(len(r.json()["participants"]))
    return {
        "rooms": rooms,
        "joiners": len(joiners),
        "outcomes": outcome,
        "max_room_size": max(sizes),
        "over_capacity_rooms": sum(1 for s in sizes if s > 4),
        "join": summary(lat),
        "_rooms": created,
    }


async def fanout(users: list[User], rooms: list[dict[str, Any]]) -> dict[str, Any]:
    members: dict[str, list[User]] = {r["id"]: [] for r in rooms}
    ids = {u.id: u for u in users}
    for r in rooms:
        resp = await users[0].http.get(f"/v1/rooms/{r['code']}")
        for p in resp.json()["participants"]:
            members[r["id"]].append(ids[p["user"]["id"]])
    everyone = [u for ms in members.values() for u in ms]
    await asyncio.gather(*(u.close_ws() for u in everyone))
    await asyncio.gather(*(u.open_ws() for u in everyone))
    for room_id, ms in members.items():
        for u in ms:
            await u.send("room.subscribe", {"roomId": room_id})
    await asyncio.gather(*(u.wait(lambda e: e["type"] == "room.snapshot") for u in everyone))
    lat: list[float] = []
    sent: dict[str, float] = {}

    async def speak(room_id: str, u: User) -> None:
        key = uuid.uuid4().hex[:12]
        sent[key] = time.perf_counter()
        await u.send("chat.send", {"roomId": room_id, "clientMsgId": key, "text": f"hi {key}"})

    async def listen(u: User, expected: int) -> None:
        got = 0
        while got < expected:
            ev = await u.wait(lambda e: e["type"] == "chat.message" and e["payload"]["message"].get("clientMsgId") in sent)
            lat.append(ev["_rx"] - sent[ev["payload"]["message"]["clientMsgId"]])
            got += 1

    listeners = [listen(u, len(ms)) for ms in members.values() for u in ms]
    t = time.perf_counter()
    await asyncio.gather(*(speak(rid, u) for rid, ms in members.items() for u in ms), *listeners)
    return {
        "rooms": len(rooms),
        "sockets": len(everyone),
        "deliveries": len(lat),
        "wall_s": round(time.perf_counter() - t, 2),
        "delivery": summary(lat),
        "_members": members,
    }


async def reconnect_storm(members: dict[str, list[User]]) -> dict[str, Any]:
    everyone = [(rid, u) for rid, ms in members.items() for u in ms]
    await asyncio.gather(*(u.close_ws() for _, u in everyone))
    lat: list[float] = []

    async def back(room_id: str, u: User) -> None:
        t0 = time.perf_counter()
        await u.open_ws()
        await u.send("room.subscribe", {"roomId": room_id, "lastSeq": 1})
        await u.wait(lambda e: e["type"] == "room.snapshot")
        lat.append(time.perf_counter() - t0)

    t = time.perf_counter()
    res = await asyncio.gather(*(back(rid, u) for rid, u in everyone), return_exceptions=True)
    return {
        "sockets": len(everyone),
        "ok": len(lat),
        "errors": sum(1 for r in res if isinstance(r, Exception)),
        "wall_s": round(time.perf_counter() - t, 2),
        "time_to_snapshot": summary(lat),
    }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--users", type=int, default=200)
    ap.add_argument("--rooms", type=int, default=40)
    args = ap.parse_args()
    users = [User(args.base, i + 1) for i in range(args.users)]
    t = time.perf_counter()
    for i in range(0, len(users), 50):
        await asyncio.gather(*(u.signup() for u in users[i : i + 50]))
    report: dict[str, Any] = {"signup_wall_s": round(time.perf_counter() - t, 2)}
    report["matchmaking_burst"] = await matchmaking_burst(users)
    joins = await concurrent_joins(users, args.rooms)
    rooms = joins.pop("_rooms")
    report["concurrent_joins"] = joins
    fan = await fanout(users, rooms)
    members = fan.pop("_members")
    report["websocket_fanout"] = fan
    report["reconnect_storm"] = await reconnect_storm(members)
    for u in users:
        await u.close_ws()
        await u.http.aclose()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
