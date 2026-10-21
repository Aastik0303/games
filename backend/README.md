# Prism backend

FastAPI + Redis + PostgreSQL implementation of the contract in [`../frontend/docs/API_CONTRACT.md`](../frontend/docs/API_CONTRACT.md): guest sessions, solo puzzles, rooms, matchmaking, server-authoritative live games, Watch Together sync, moderation and admin.

## Run locally

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate            # Windows (bash: source .venv/Scripts/activate); macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env

# Option A: no Redis installed. In-process fake Redis, single process, dev only
PRISM_REDIS_URL=memory:// uvicorn app.main:app_factory --factory --reload --port 8000

# Option B: real Redis
docker run -d -p 6379:6379 redis:7.4.2-alpine
uvicorn app.main:app_factory --factory --reload --port 8000
```

- API docs (OpenAPI): http://localhost:8000/docs
- Point the frontend at it with `NEXT_PUBLIC_API_MODE=http` and `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` in `frontend/.env.local`.
- Make yourself admin: copy your user id from `GET /v1/session`, then run `python -m app.cli grant-role --user <id> --role admin --operator "<your name>"`.

Full stack (frontend + API + Redis + PostgreSQL), from the repo root: `docker compose up --build`.

## Checks

```bash
ruff check app tests && ruff format --check app tests
mypy app
pytest                                            # in-process fake Redis
PRISM_TEST_REDIS_URL=redis://localhost:6379/15 pytest   # same suite on a real Redis (flushes db 15)
alembic upgrade head                              # migrations (PRISM_DATABASE_URL)
python loadtest/load.py --base http://localhost:8000    # needs PRISM_TRUST_PROXY_HEADERS=true on the server
```

## API routes

| Area | Routes |
|---|---|
| Health | `GET /v1/health/live`, `GET /v1/health/ready` (Redis + DB), `GET /v1/version`, `GET /metrics` |
| Session & profile | `GET/POST/DELETE /v1/session`, `PUT /v1/session/profile`, `POST /v1/session/refresh`, `GET/PUT /v1/me/privacy`, `GET /v1/me/rate-limits` |
| Config & catalog | `GET /v1/config/flags`, `GET /v1/community/pulse`, `GET /v1/games`, `GET /v1/games/{id}` |
| Solo | `POST /v1/solo/sessions`, `POST /v1/solo/sessions/{id}/answers` (supports `Idempotency-Key`), `…/hints`, `…/clues/{clueId}`, `…/advance` |
| Rooms | `POST /v1/rooms`, `GET /v1/rooms/{code}`, `POST /v1/rooms/{code}/join`, `POST /v1/rooms/by-id/{id}/leave` |
| Matchmaking | `POST /v1/matchmaking/tickets`, `GET/DELETE /v1/matchmaking/tickets/{id}` |
| Realtime | `POST /v1/realtime/tickets`, `WS /v1/ws?ticket=…` (commands and events in [docs/REALTIME.md](docs/REALTIME.md)) |
| Moderation | `POST /v1/reports`, `GET /v1/blocks`, `PUT/DELETE /v1/blocks/{userId}` |
| Admin / moderators | `GET /v1/admin/overview`, `GET /v1/admin/games`, `PATCH /v1/admin/games/{id}`, `GET /v1/admin/reports?status=`, `POST /v1/admin/reports/{id}/resolution`, `GET /v1/admin/flags`, `PUT /v1/admin/flags/{key}`, `POST /v1/admin/rooms/{id}/close`, `POST /v1/admin/rooms/{id}/participants/{userId}/remove`, `GET /v1/admin/audit` |

Errors are always `{"error": {"code", "message", "fields"?, "requestId"?}}`, with codes `validation` 422, `unauthorized`/`session_expired` 401, `forbidden` 403, `not_found` 404, `conflict`/`room_full` 409, `payload_too_large` 413, `rate_limited` 429 (+ `Retry-After`), `unavailable` 503, and `server` 500.

Watch Together uses rooms with `activity.kind = "watch"` plus the `watch.*` WebSocket commands. There are no separate watch endpoints.

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, storage decisions, concurrency, scaling, diagram
- [REDIS_KEYS.md](docs/REDIS_KEYS.md): every key, type and TTL, plus the Lua scripts
- [REALTIME.md](docs/REALTIME.md): event contract, delivery guarantees, client usage
- [MATCHMAKING.md](docs/MATCHMAKING.md): sequence diagram, what happens if a worker dies
- [SECURITY.md](docs/SECURITY.md): cookie vs token, CSRF, role matrix, abuse controls, retention, checklist
- [OPERATIONS.md](docs/OPERATIONS.md): runbook, metrics, backup/restore, load-test results, deployment checklist
- [ADDING_A_GAME.md](docs/ADDING_A_GAME.md): engine contract
- [TEST_REPORT.md](docs/TEST_REPORT.md): what ran, what passed, what wasn't run

## Known gaps (TODO)

- Cooperative shared-clue puzzle (engine supports it; not built).
- WebRTC audio/video: not implemented. It needs an SFU, and the API would only issue join tokens. Screen sharing stays browser-local, as in the frontend.
- Guest identities can be recreated after a suspension (there are no accounts). Per-IP sign-up limits slow this down but don't prevent it.
- Not yet verified: the test suite on real Redis and PostgreSQL, the Docker builds, and a browser run of frontend + backend together (see TEST_REPORT.md).
