"""Solo game sessions: server-dealt puzzles, server grading, answer keys never leave the server.

A session document (Redis, TTL ``solo_ttl_sec``) stores the seed, content
version and the dealt item ids — enough to reproduce and audit the session —
plus counters. Every change goes through a compare-and-set update, so two
concurrent submissions can't both spend the same attempt.
"""

from __future__ import annotations

import json
import random
import secrets
from typing import Any

from app.errors import AppError
from app.games.content import CONTENT_VERSION
from app.games.engine import Answer, PuzzleProgress, RuleError
from app.games.registry import GAMES
from app.infra import Infra, new_id
from app.redis import keys
from app.services.sessions import Principal

SESSION_GONE = AppError("not_found", "That game session has ended.")


class SoloService:
    def __init__(self, infra: Infra) -> None:
        self.infra = infra

    @property
    def _ttl_ms(self) -> int:
        return self.infra.settings.solo_ttl_sec * 1000

    async def start(self, principal: Principal, game_id: str, difficulty: str) -> dict[str, Any]:
        summary, game = await self.infra.services.catalog.get_enabled(game_id)
        if "solo" not in game.modes:
            raise AppError("validation", "This game is multiplayer only.", fields={"gameId": "Not playable solo"})
        if difficulty not in summary["difficulties"]:
            raise AppError("validation", "Difficulty not available for this game.", fields={"difficulty": "Unavailable"})
        seed = secrets.randbits(63)
        try:
            items = game.deal(difficulty, random.Random(seed))
        except RuleError as e:
            raise AppError("validation", str(e)) from e
        doc = {
            "id": new_id("solo"),
            "userId": principal.id,
            "gameId": game.id,
            "difficulty": difficulty,
            "seed": seed,
            "contentVersion": CONTENT_VERSION,
            "items": items,
            "index": 0,
            "score": 0,
            "attemptsLeft": game.attempts,
            "attemptsUsed": 0,
            "hintsLeft": game.hints_per_session,
            "hintsThisPuzzle": 0,
            "closed": False,
            "revealed": {},
            "status": "active",
        }
        await self.infra.docs.create(keys.solo_doc(doc["id"]), doc, self._ttl_ms)
        return self.view(doc)

    def view(self, doc: dict[str, Any]) -> dict[str, Any]:
        game = GAMES[doc["gameId"]]
        return {
            "id": doc["id"],
            "gameId": doc["gameId"],
            "difficulty": doc["difficulty"],
            "index": doc["index"],
            "total": len(doc["items"]),
            "score": doc["score"],
            "status": doc["status"],
            "puzzle": game.public(doc["items"][doc["index"]]),
            "hintsLeft": doc["hintsLeft"],
            "revealedClues": list(doc["revealed"].values()),
        }

    async def _owned(self, principal: Principal, session_id: str) -> None:
        current = await self.infra.docs.get(keys.solo_doc(session_id))
        # Someone else's session id is indistinguishable from an unknown one.
        if current is None or current[1]["userId"] != principal.id:
            raise SESSION_GONE

    async def submit(
        self, principal: Principal, session_id: str, answer: Answer, idempotency_key: str | None = None
    ) -> dict[str, Any]:
        await self._owned(principal, session_id)
        idem_key = keys.idem(principal.id, f"solo:{session_id}", idempotency_key) if idempotency_key else None
        if idem_key:
            claimed = await self.infra.redis.set(idem_key, "pending", nx=True, ex=self.infra.settings.idempotency_ttl_sec)
            if not claimed:
                cached = await self.infra.redis.get(idem_key)
                if cached and cached != "pending":
                    return dict(json.loads(cached))
                raise AppError("conflict", "This answer is already being processed.")

        def mutate(doc: dict[str, Any]) -> dict[str, Any]:
            if doc["status"] == "complete" or doc["closed"]:
                raise AppError("conflict", "This puzzle is already closed.")
            game = GAMES[doc["gameId"]]
            progress = PuzzleProgress(doc["attemptsUsed"], doc["hintsThisPuzzle"], len(doc["revealed"]))
            try:
                grade = game.grade(doc["items"][doc["index"]], answer, progress)
            except RuleError as e:
                raise AppError("validation", str(e)) from e
            doc["attemptsLeft"] -= 1
            doc["attemptsUsed"] += 1
            if grade.correct or doc["attemptsLeft"] <= 0:
                doc["closed"] = True
            doc["score"] += grade.score_delta
            result: dict[str, Any] = {
                "correct": grade.correct,
                "feedback": grade.feedback,
                "scoreDelta": grade.score_delta,
                "totalScore": doc["score"],
                "attemptsLeft": doc["attemptsLeft"],
                "closed": doc["closed"],
            }
            if doc["closed"]:
                result["solution"] = grade.solution
            return result

        try:
            result = await self.infra.docs.update(keys.solo_doc(session_id), mutate, self._ttl_ms, missing=SESSION_GONE)
        except Exception:
            if idem_key:
                await self.infra.redis.delete(idem_key)
            raise
        if idem_key:
            await self.infra.redis.set(idem_key, json.dumps(result), ex=self.infra.settings.idempotency_ttl_sec)
        return result

    async def hint(self, principal: Principal, session_id: str) -> dict[str, Any]:
        await self._owned(principal, session_id)

        def mutate(doc: dict[str, Any]) -> dict[str, Any]:
            if doc["closed"]:
                raise AppError("conflict", "This puzzle is already closed.")
            if doc["hintsLeft"] <= 0:
                raise AppError("conflict", "No hints left in this session.")
            game = GAMES[doc["gameId"]]
            progress = PuzzleProgress(doc["attemptsUsed"], doc["hintsThisPuzzle"], len(doc["revealed"]))
            text = game.hint(doc["items"][doc["index"]], progress)
            doc["hintsLeft"] -= 1
            doc["hintsThisPuzzle"] += 1
            return {"hint": text, "hintsLeft": doc["hintsLeft"]}

        return await self.infra.docs.update(keys.solo_doc(session_id), mutate, self._ttl_ms, missing=SESSION_GONE)

    async def inspect_clue(self, principal: Principal, session_id: str, clue_id: str) -> dict[str, Any]:
        await self._owned(principal, session_id)

        def mutate(doc: dict[str, Any]) -> dict[str, str]:
            game = GAMES[doc["gameId"]]
            if game.kind != "mystery":
                raise AppError("validation", "This puzzle has no clues.")
            clue = game.clue(doc["items"][doc["index"]], clue_id)
            if clue is None:
                raise AppError("not_found", "Unknown clue.")
            doc["revealed"][clue["id"]] = clue
            return clue

        return await self.infra.docs.update(keys.solo_doc(session_id), mutate, self._ttl_ms, missing=SESSION_GONE)

    async def advance(self, principal: Principal, session_id: str) -> dict[str, Any]:
        await self._owned(principal, session_id)

        def mutate(doc: dict[str, Any]) -> dict[str, Any]:
            if doc["status"] == "complete":
                return doc
            if doc["index"] + 1 >= len(doc["items"]):
                doc["status"], doc["closed"] = "complete", True
                return doc
            game = GAMES[doc["gameId"]]
            doc["index"] += 1
            doc["attemptsLeft"], doc["attemptsUsed"] = game.attempts, 0
            doc["hintsThisPuzzle"], doc["closed"], doc["revealed"] = 0, False, {}
            return doc

        doc = await self.infra.docs.update(keys.solo_doc(session_id), mutate, self._ttl_ms, missing=SESSION_GONE)
        return self.view(doc)
