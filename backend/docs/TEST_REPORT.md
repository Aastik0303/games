# Test report (2026-10-18)

## What was run, and where

| Check | Command | Result |
|---|---|---|
| Lint | `ruff check app tests loadtest` + `ruff format --check` | pass |
| Types | `mypy app` (strict) | pass, 52 files |
| Backend tests | `pytest` (Windows, Python 3.13, in-process fake Redis with Lua, SQLite) | **104 passed** |
| Content validation | `validate_content()` (also in tests) | pass (found and fixed 2 hard logic puzzles that had multiple solutions) |
| Migration | `alembic upgrade head` on a fresh DB vs. models | pass |
| Load scenarios | `loadtest/load.py`, 200 users, one process, fake Redis | see OPERATIONS.md (all correctness checks held) |
| Frontend | `npm run typecheck`, `npm test` (58 passed), `npm run lint` | pass (frontend code unchanged) |

**Not run:**
- the suite against a real Redis (`PRISM_TEST_REDIS_URL`). CI is configured to do this with Redis 7.4, but no Redis server or running Docker daemon was available locally;
- PostgreSQL (all DB tests used SQLite);
- Docker image builds and `docker compose up`;
- the frontend in `http` mode against this backend in a real browser;
- `npm run build`;
- `pip-audit` / `npm audit`.

## Acceptance flows (QA prompt)

| # | Flow | Evidence | Status |
|---|---|---|---|
| 1 | Guest profile, minimal data, explicit consent | `test_session`: consent required, interests dropped without opt-in, contact-like names rejected, no birth date, HttpOnly cookie | **pass** |
| 2 | Solo game with server-validated results | `test_games`: word/riddle/logic/mystery end-to-end, answers absent from payloads, attempts/hints/scoring, solution only when closed, idempotent retries | **pass** |
| 3 | 2–4 users matched exactly once | `test_matchmaking`: two instances × 5 matchers race over 4 players → exactly 2 rooms; concurrent cancel; worker-death recovery | **pass** |
| 4 | Private room by code; invalid/expired/full fail safely | `test_rooms`: case-insensitive codes, 404 for invalid/expired, `room_full`, 12-way capacity race admits exactly 3, code-guessing rate limit with `Retry-After` | **pass** |
| 5 | Host picks game, players ready, consistent state | `test_ws`, `test_live`: host-only commands, ready gating, `room.updated`/`game.state` on every client, cross-instance fanout (`test_multiworker`) | **pass** |
| 6 | Reconnect without duplicate actions or corrupted scores | `test_ws::test_reconnect…`, `test_duplicate_command_id_has_one_effect` (same id from a new socket), `test_live` (late and duplicate timers are no-ops, per-round attempt limits) | **pass** |
| 7 | Watch Together sync; screen-share permission denial | backend: host-only control, server timestamps, URL allowlist (`test_ws`, `test_watch`). Drift reconciliation, screen-share denial and the media UI live in the frontend and were **not tested here** | **partial** |
| 8 | Report / block / leave; blocked users not re-matched | `test_admin` (report → moderator → suspend → session revoked), `test_rooms` (blocked can't join), `test_ws` (blocked chat hidden), `test_matchmaking::test_blocked_players_are_not_rematched` | **pass** |
| 9 | Non-admin can't reach admin APIs directly | `test_admin`: every admin GET/write as anonymous (401), player (403), moderator (scoped 403s); state unchanged afterwards | **pass** |
| 10 | Redis outage → controlled errors and recovery | `test_session` (503 `unavailable` + `Retry-After`, readiness 503, success after recovery), `test_multiworker` (WS ack `server` error, listener reconnects and pushes a snapshot) | **pass** (simulated with fake Redis) |
| 11 | Responsive and accessible UI on mobile and desktop | frontend concern. No browser or device testing was done in this milestone | **not run** |
| 12 | Retention rules and cleanup TTLs | `test_presence_ttl` (every ephemeral key has a TTL; stale presence → reconnecting → offline; host transfer; abandoned room closed), `test_cli` (retention job deletes, redacts and keeps the right rows) | **pass** |

Browser and device coverage: none yet. That belongs to a frontend E2E milestone (for example Playwright on Chromium, Firefox, WebKit and a mobile viewport against `docker compose up`).
