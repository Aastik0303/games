# Operations runbook

## Environments

| | development | test | production |
|---|---|---|---|
| Redis | `redis://localhost:6379/0` or `memory://` (one process) | `memory://<name>` per test, or real Redis via `PRISM_TEST_REDIS_URL` | managed Redis with AUTH + TLS + replica |
| Database | SQLite file, tables auto-created | SQLite per test | PostgreSQL, `alembic upgrade head` |
| Cookie | not `Secure` (http://localhost) | n/a | `Secure` required |
| Startup guard | none | none | `validate_for_env()` refuses insecure cookies, `memory://`, SQLite, auto-create, `ws://` |

## Startup and shutdown

- **Startup:** validate settings, then validate game content (fails fast on a broken puzzle), connect Redis and the DB, seed default feature flags, then start the event listener and the background loops (matcher every 0.5 s, timers every 0.1 s, sweeper every 5 s under a Redis lock).
- **Readiness:** `GET /v1/health/ready` returns 200 only if Redis `PING` and `SELECT 1` both succeed within 2 s. Point the load balancer here. **Liveness:** `GET /v1/health/live`.
- **Shutdown (SIGTERM):** sockets are closed with 1012 (clients reconnect elsewhere), loops stop, then connections close. In-flight timer jobs are leased, so another instance picks them up.

## Health signals (Prometheus, `GET /metrics`)

| Metric | Watch for |
|---|---|
| `prism_http_requests_total{status}`, `prism_http_request_seconds` | 5xx rate, p95 latency |
| `prism_redis_errors_total{kind}` | any sustained increase = Redis trouble |
| `prism_ws_connections`, `prism_ws_connects_total`, `prism_ws_reconnects_total` | reconnect storms |
| `prism_ws_slow_consumer_closes_total`, `prism_ws_rejected_frames_total` | abusive or overloaded clients |
| `prism_mm_queue_depth`, `prism_mm_match_wait_seconds` | matching health |
| `prism_cas_conflicts_total` | contention (expected to be low) |
| `prism_rate_limited_total{policy}` | abuse or limits that are too tight |
| `prism_timer_jobs_total{result}` | `error` / `redis_error` > 0 |

Wire `app.observability.set_error_hook()` to Sentry (or similar) at startup to forward unexpected exceptions. Logs are JSON lines on stdout. Correlate them with `request_id`, which is also returned as `X-Request-ID` and in error bodies.

## Incidents

| Symptom | Likely cause | Action |
|---|---|---|
| `/ready` 503, `redis` unavailable | Redis down or failover | API returns 503s and clients retry. On recovery, listeners resubscribe and push snapshots. Rooms survive if Redis kept its data |
| Redis data lost (flush or failover without replica) | | Everyone is signed out. Rooms, games and queues are gone. Profiles, blocks, reports and audit are intact. No action beyond communicating |
| Players stuck "searching" | matcher not running (`PRISM_RUN_BACKGROUND_WORKERS=false` everywhere?) | ensure at least one instance runs workers. Check `prism_mm_claim_conflicts_total` and logs for `loop: matcher` |
| Rounds don't advance | timer loop not running, or Redis errors | same as above. Leased jobs requeue after 10 s |
| Spike in reports about one user | | moderator resolves with `suspend` (sessions revoked, removed from rooms, 7-day suspension). Severe or legal cases follow your escalation policy |
| Abusive room | | `POST /v1/admin/rooms/{id}/close {reason}` (audited) |

## Backup and restore (PostgreSQL only; Redis is not backed up by design)

- Enable managed PITR (point-in-time recovery) with at least 7 days of WAL, plus a nightly logical backup. Encrypt it and store it in another region with restricted access:
  `pg_dump --format=custom --no-owner "$DATABASE_URL" > prism-$(date +%F).dump`
- **Restore drill (quarterly):** `createdb prism_restore && pg_restore --no-owner -d prism_restore prism-YYYY-MM-DD.dump`, run `alembic current` (it must match the release), then point a staging instance at it and run the smoke tests.
- Retention still applies to backups: expire backups after 35 days so deleted profiles don't live on indefinitely.

## Scaling and capacity

- Scale API replicas on CPU and socket count. No sticky sessions needed. The LB must allow WebSocket upgrades and idle timeouts over 60 s.
- One uvicorn process per container. Use more replicas, not more workers per container.
- Redis memory is dominated by chat lists (≤200 messages per room) and room docs. Estimate about 60 KB per active room.
- See ARCHITECTURE.md for Redis Cluster notes and the SFU requirement for future audio/video.

## Load test results (measured, not projected)

`python loadtest/load.py --users 200 --rooms 40` against **one uvicorn process on a Windows dev laptop with the in-process fake Redis (`memory://`) and SQLite**, 2026-10-18. Fakeredis is pure Python and much slower than real Redis, so treat these numbers as a correctness check plus a lower bound. Re-run against staging with real Redis and PostgreSQL before setting SLOs.

| Scenario | Correctness | Latency |
|---|---|---|
| Matchmaking burst: 200 users enqueue at once, groups of 2 | 200/200 matched, 100 rooms, 0 wrong-size rooms, 0 errors | enqueue p50 599 ms / p95 1032 ms; time-to-matched p50 1248 ms / p95 2084 ms |
| Concurrent joins: 160 joiners race for 40 rooms × 3 free seats | 120 joined, 40 `room_full`, 0 rooms over capacity | p50 762 ms / p95 1225 ms |
| WebSocket fanout: 160 sockets in 40 rooms, everyone sends one chat message | 640/640 deliveries | p50 311 ms / p95 508 ms |
| Reconnect storm: 160 sockets drop and reconnect at once | 160/160 snapshots, 0 errors | p50 3099 ms / p95 3343 ms |

Suggested targets to verify on real infrastructure (2 API replicas, managed Redis): 1,000 concurrent enqueues matched with p95 < 2 s, room-join p95 < 150 ms, fanout p95 < 150 ms, reconnect of 2,000 sockets to snapshot with p95 < 5 s, and zero over-capacity rooms or duplicate matches.

## Production deployment checklist

1. Build pinned images (`backend/Dockerfile` runs as non-root and has a healthcheck; `frontend/Dockerfile` takes `NEXT_PUBLIC_*` build args).
2. Provision PostgreSQL (PITR on), Redis (AUTH, TLS, replica, `noeviction`), and secrets in a secret manager.
3. Set the environment from `.env.example` with `PRISM_ENV=production`. Startup refuses unsafe values.
4. Release step: `alembic upgrade head`.
5. Deploy at least 2 API replicas behind TLS with WebSocket support. Readiness is `/v1/health/ready`.
6. Restrict `/metrics`. Hook up dashboards and alerts for the metrics above, plus error tracking.
7. Grant the first admin with the CLI. Confirm it appears in `/v1/admin/audit`.
8. Schedule `python -m app.cli retention` daily.
9. Run `loadtest/load.py` against staging with real Redis and record the results here.
10. Walk through SECURITY.md's checklist.
