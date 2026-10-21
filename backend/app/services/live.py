"""Live multiplayer rounds (server-authoritative).

Flow per game run: countdown -> (answering -> reveal) x rounds -> finished.
Deadlines are distributed timers; every transition is a compare-and-set on the
room doc guarded by the run id, round and phase, so late or duplicate timer
firings do nothing. Clients only send answers; the server decides
correctness, turn order, scores and timing. Answer keys never leave the server:
the runtime stores item ids, and the solution text appears only in
``lastReveal`` after a round closes.
"""

from __future__ import annotations

import random
import secrets
from typing import Any

from app.errors import AppError
from app.games.content import CONTENT_VERSION
from app.games.registry import live_game
from app.infra import Infra, new_id
from app.observability import metrics
from app.schemas.common import iso_ms
from app.services.rooms import NOT_MEMBER, bump, find, now_ms
from app.services.sessions import Principal

ROUNDS = 5
ROUND_MS = 30_000
REVEAL_MS = 4_000
COUNTDOWN_MS = 3_000
DONE_DELAY_MS = 600
MAX_ATTEMPTS = 3


class LiveGameService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra
        infra.services.timers.register("live", self.on_timer)

    @property
    def rooms(self) -> Any:
        return self.infra.services.rooms

    async def _publish_state(self, doc: dict[str, Any]) -> None:
        if doc["game"]:
            room_id = doc["room"]["id"]
            await self.infra.services.events.publish_room(
                room_id, "game.state", {"roomId": room_id, "state": doc["game"]["state"]}
            )

    async def start(self, principal: Principal, room_id: str) -> None:
        await self.infra.services.flags.require("multiplayer", "Multiplayer is currently disabled.")
        doc = await self.rooms.require_member(principal, room_id)
        if doc["room"]["hostId"] != principal.id:
            raise AppError("forbidden", "Only the host can start")
        game_id = doc["room"]["activity"].get("gameId") or ""
        try:
            summary, _ = await self.infra.services.catalog.get_enabled(game_id)
        except AppError as e:
            raise AppError("validation", "This game is unavailable") from e
        game = live_game(game_id)
        if game is None:
            raise AppError("validation", "This game can't be played live")
        difficulty = doc["room"]["activity"].get("difficulty") or summary["difficulties"][0]
        seed = secrets.randbits(63)
        items = game.deal(difficulty, random.Random(seed), ROUNDS)
        run_id = new_id("run", 6)

        def fn(d: dict[str, Any]) -> None:
            if d["room"]["hostId"] != principal.id:
                raise AppError("forbidden", "Only the host can start")
            replay = d["room"]["phase"] == "playing" and d["game"] and d["game"]["state"]["phase"] == "finished"
            if d["room"]["phase"] != "lobby" and not replay:
                raise AppError("conflict", "An activity is already running")
            people = d["room"]["participants"]
            if len(people) < game.min_players:
                raise AppError("validation", f"Need at least {game.min_players} players")
            if not replay and any(p["role"] != "host" and not p["ready"] for p in people):
                raise AppError("conflict", "Everyone needs to be ready")
            extended = any(m.get("extended") for m in d["meta"]["members"].values())
            order = [p["user"]["id"] for p in people]
            d["room"]["phase"] = "playing"
            d["meta"]["runId"] = run_id
            d["game"] = {
                "runId": run_id,
                "seed": seed,
                "contentVersion": CONTENT_VERSION,
                "items": items,
                "attempts": {},
                "turnOrder": order,
                "roundMs": int(ROUND_MS * (1.5 if extended else 1)),
                "state": {
                    "gameId": game.id,
                    "kind": game.kind,
                    "title": game.title,
                    "round": 0,
                    "totalRounds": len(items),
                    "phase": "countdown",
                    "puzzle": None,
                    "turn": {"mode": "simultaneous"},
                    "endsAt": iso_ms(now_ms() + COUNTDOWN_MS),
                    "scores": dict.fromkeys(order, 0),
                    "solvedBy": [],
                },
            }
            bump(d)

        _, doc = await self.rooms.mutate(room_id, fn)
        metrics.inc("live_games_started_total", game=game.id)
        await self.rooms.publish_room(doc)
        await self.rooms.system_message(room_id, f"{game.title} is starting!")
        await self._publish_state(doc)
        await self.infra.services.timers.schedule("live", COUNTDOWN_MS, room=room_id, run=run_id, round=1, step="round")

    # --- timer-driven transitions -----------------------------------------------
    async def on_timer(self, job: dict[str, Any]) -> None:
        step, room_id, run_id, rnd = job["step"], job["room"], job["run"], int(job["round"])
        if step == "round":
            await self._start_round(room_id, run_id, rnd)
        elif step == "reveal":
            await self._reveal(room_id, run_id, rnd)
        elif step == "next":
            await self._next(room_id, run_id, rnd)

    @staticmethod
    def _current(d: dict[str, Any], run_id: str) -> dict[str, Any] | None:
        g = d["game"]
        return g if g and g["runId"] == run_id and d["room"]["phase"] == "playing" else None

    async def _start_round(self, room_id: str, run_id: str, rnd: int) -> None:
        def fn(d: dict[str, Any]) -> bool:
            g = self._current(d, run_id)
            if not g or g["state"]["round"] >= rnd:
                return False
            game = live_game(g["state"]["gameId"])
            if game is None:
                return False
            present = [p["user"]["id"] for p in d["room"]["participants"]]
            g["turnOrder"] = [u for u in g["turnOrder"] if u in present] or present
            turns = game.turn_mode == "turns"
            active = g["turnOrder"][(rnd - 1) % len(g["turnOrder"])] if g["turnOrder"] else None
            g["attempts"] = {}
            g["state"].update(
                {
                    "round": rnd,
                    "phase": "answering",
                    "puzzle": game.public(g["items"][rnd - 1]),
                    "solvedBy": [],
                    "turn": {"mode": "turns", "activeUserId": active} if turns and active else {"mode": "simultaneous"},
                    "endsAt": iso_ms(now_ms() + g["roundMs"]),
                }
            )
            g["state"].pop("lastReveal", None)
            return True

        try:
            changed, doc = await self.rooms.mutate(room_id, fn)
        except AppError:
            return
        if changed:
            await self._publish_state(doc)
            await self.infra.services.timers.schedule(
                "live", doc["game"]["roundMs"], room=room_id, run=run_id, round=rnd, step="reveal"
            )

    async def _reveal(self, room_id: str, run_id: str, rnd: int) -> None:
        def fn(d: dict[str, Any]) -> bool:
            g = self._current(d, run_id)
            if not g or g["state"]["round"] != rnd or g["state"]["phase"] != "answering":
                return False
            game = live_game(g["state"]["gameId"])
            solution = game.solution_text(g["items"][rnd - 1]) if game else ""
            g["state"].update(
                {
                    "phase": "reveal",
                    "endsAt": iso_ms(now_ms() + REVEAL_MS),
                    "lastReveal": {"solution": solution, "correctUserIds": list(g["state"]["solvedBy"])},
                }
            )
            return True

        try:
            changed, doc = await self.rooms.mutate(room_id, fn)
        except AppError:
            return
        if changed:
            await self._publish_state(doc)
            await self.infra.services.timers.schedule("live", REVEAL_MS, room=room_id, run=run_id, round=rnd, step="next")

    async def _next(self, room_id: str, run_id: str, rnd: int) -> None:
        doc = await self.rooms.load(room_id)
        g = self._current(doc, run_id) if doc else None
        if not g or g["state"]["round"] != rnd or g["state"]["phase"] != "reveal":
            return
        if rnd < g["state"]["totalRounds"]:
            await self._start_round(room_id, run_id, rnd + 1)
            return

        def fn(d: dict[str, Any]) -> bool:
            cur = self._current(d, run_id)
            if not cur or cur["state"]["round"] != rnd or cur["state"]["phase"] != "reveal":
                return False
            cur["state"].update({"phase": "finished", "endsAt": None, "puzzle": None})
            return True

        changed, doc = await self.rooms.mutate(room_id, fn)
        if changed:
            await self._publish_state(doc)
            await self.rooms.system_message(room_id, "Game over — check the scoreboard!")
            metrics.inc("live_games_finished_total")

    # --- answers ------------------------------------------------------------------
    async def submit(self, principal: Principal, room_id: str, rnd: int, answer: dict[str, Any]) -> dict[str, Any]:
        await self.infra.services.ratelimit.hit("game_submit", principal.id)
        uid = principal.id
        kind = answer.get("kind")
        text = answer.get("text")
        if kind not in ("word", "riddle") or not isinstance(text, str) or not text.strip() or len(text) > 60:
            raise AppError("validation", "Enter an answer")

        def fn(d: dict[str, Any]) -> dict[str, Any]:
            if not find(d, uid):
                raise NOT_MEMBER
            g = d["game"]
            if d["room"]["phase"] != "playing" or not g:
                raise AppError("conflict", "No game is running")
            st = g["state"]
            if st["phase"] != "answering" or st["round"] != rnd:
                raise AppError("conflict", "That round has ended")
            if st["turn"]["mode"] == "turns" and st["turn"].get("activeUserId") != uid:
                raise AppError("not_your_turn", "Wait for your turn")
            if uid in st["solvedBy"]:
                raise AppError("conflict", "You already solved this round")
            if kind != st["kind"]:
                raise AppError("validation", "Wrong answer type")
            used = int(g["attempts"].get(uid, 0))
            if used >= MAX_ATTEMPTS:
                raise AppError("conflict", "No attempts left this round")
            g["attempts"][uid] = used + 1
            game = live_game(st["gameId"])
            correct = bool(game and game.live_correct(g["items"][rnd - 1], text))
            if correct:
                order = len(st["solvedBy"])
                points = 100 if st["turn"]["mode"] == "turns" else (100, 70)[order] if order < 2 else 50
                st["solvedBy"].append(uid)
                st["scores"][uid] = int(st["scores"].get(uid, 0)) + points
            left = MAX_ATTEMPTS - (used + 1)
            if st["turn"]["mode"] == "turns":
                done = correct or left == 0
            else:
                done = all(
                    p["user"]["id"] in st["solvedBy"] or int(g["attempts"].get(p["user"]["id"], 0)) >= MAX_ATTEMPTS
                    for p in d["room"]["participants"]
                )
            return {"correct": correct, "attemptsLeft": left, "done": done, "run": g["runId"]}

        out, doc = await self.rooms.mutate(room_id, fn)
        metrics.inc("live_answers_total", correct=str(out["correct"]).lower())
        if out["correct"]:
            await self._publish_state(doc)
        if out["done"]:
            await self.infra.services.timers.schedule(
                "live", DONE_DELAY_MS, room=room_id, run=out["run"], round=rnd, step="reveal"
            )
        return {"correct": out["correct"], "attemptsLeft": out["attemptsLeft"]}
