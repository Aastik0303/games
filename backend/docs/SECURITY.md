# Security, privacy and trust

## Session design: cookie, not bearer token

- `POST /v1/session` sets `prism_session`, which is 256 random bits with `HttpOnly`, `Secure` (required in production), `SameSite=Lax` and `Path=/`. JavaScript never sees it, so an XSS can't exfiltrate it.
- Redis stores only `sha256(token)` → `{uid, exp}`. A Redis dump can't be replayed as a cookie.
- The token is rotated whenever a profile is (re)created (prevents session fixation). Sign-out deletes every session of the user. Suspension revokes all sessions and closes their sockets (4401).
- **CSRF:** cookies are sent automatically, so state-changing requests (POST/PUT/PATCH/DELETE under `/v1/`) must carry `X-Prism-Client: web` and, if an `Origin` header is present, it must be in the allowlist. Browsers can't add custom headers cross-site without a CORS preflight, and preflights from foreign origins are refused. `SameSite=Lax` is defence in depth.
- **WebSockets** authenticate with a single-use 30 s ticket minted over the cookie-authenticated API. The handshake `Origin` is checked, which blocks cross-site WebSocket hijacking.
- A bearer-token design would avoid CSRF but expose tokens to JavaScript. That's the wrong trade-off for a browser-only client.
- **CORS** is an explicit allowlist (`PRISM_CORS_ORIGINS`) with credentials. `*` is rejected at startup.

## Role matrix (enforced in `app/deps.py` on every request)

| Capability | Player | Moderator | Admin |
|---|:-:|:-:|:-:|
| Profile, solo, rooms, matchmaking, chat, report, block | ✓ | ✓ | ✓ |
| Host-only room commands | host of that room | host of that room | host of that room |
| `GET /v1/admin/overview` | | ✓ | ✓ |
| Reports queue + resolve (dismiss / warn / remove_content / suspend) | | ✓ | ✓ |
| Close room / remove participant | | ✓ | ✓ |
| Catalog changes, feature flags | | | ✓ |
| Audit log | | | ✓ |

- Roles live in the database and are re-read on every request. The client can't send roles (unknown fields are rejected or ignored). Tested by `tests/test_admin.py`, which calls every admin endpoint directly as anonymous, player and moderator.
- **No backdoor or default admin.** Roles are granted to an existing profile by an operator with database access: `python -m app.cli grant-role --user u_… --role admin --operator "name, ticket"`. Each grant is written to the audit log.
- Moderators can't resolve reports about themselves. Admins can't be suspended from the queue.

## Abuse protections

| Threat | Mitigation |
|---|---|
| Room-code guessing | 8 symbols from 31 (~39.6 bits), server-generated with `secrets`. Misses limited to 10/10 min per user and 30/10 min per IP (checked before lookup). Unknown and closed rooms are indistinguishable |
| Replayed / duplicate actions | REST `Idempotency-Key` (solo answers). WS command ids cached per socket and in Redis for 10 min. Chat idempotent by `clientMsgId`. Answers bound to `round` and turn |
| Capacity races, double matches | CAS documents and atomic Lua claims (see ARCHITECTURE.md) |
| Oversized payloads | 64 KiB HTTP body cap (streamed). 16 KiB WS frame cap (and uvicorn `--ws-max-size`). Field length limits in every schema |
| Injection | Pydantic validation everywhere. SQLAlchemy parameterized queries. No string-built SQL or Redis Lua |
| Flooding | Redis rate limits (`app/services/ratelimit.py`) for sign-up, joins, rooms, matchmaking, tickets, connects, chat, reactions, reports, blocks, admin writes. Per-socket limit 40 commands/10 s, with disconnect after repeated violations |
| Cheating | Server-dealt puzzles, server grading, answer keys never sent before reveal, attempts and turns enforced, scores server-owned |
| Unsafe embeds | Watch sources: https only, host allowlist, no IP literals, credentials or odd ports, video extensions only. The server never fetches, proxies or decrypts media |
| Info leaks in errors | 5xx bodies are generic. Request id for support. Stack traces only in server logs |

## Logging and privacy

- JSON logs with request ids. Query strings are never logged (tickets), and uvicorn's access log is disabled. A redacting formatter blanks keys such as `token`, `cookie`, `text`, `details`, `note`, `ageBand`, `interests` and `profile`.
- No birth dates: only an **age band**. `isMinor` is derived server-side. No gender, location or contact data. A display name that looks like contact info is rejected.
- Other players only ever see `PublicUser {id, displayName, avatarHue, isBot}`.
- Interests are dropped unless the person opts in to interest-based matching.
- Minors: forced `strict` chat filter (links stripped) and `matched_only` invites, segregated rooms and matching, and `minor_safety`/`personal_info` reports are high priority. A minor can't edit their age band to an adult one (they must create a new profile).

## Retention and deletion

| Data | Where | Kept |
|---|---|---|
| Sessions, WS tickets, rooms, chat, games, queues, presence | Redis | minutes to hours (TTLs in REDIS_KEYS.md); chat dies with the room |
| Guest profile + blocks | PostgreSQL | deleted on sign-out (`DELETE /v1/session`), or by the retention job after 30 days of inactivity |
| Reports | PostgreSQL | free-text details and message excerpt redacted 90 days after resolution; deleted after 365 days. Open reports are never auto-deleted |
| Audit events | PostgreSQL | 730 days |

Run `python -m app.cli retention` daily (cron or a scheduled job).

## Production security checklist

- [ ] TLS terminated at the load balancer. HSTS on the frontend origin. `PRISM_COOKIE_SECURE=true`. `PRISM_PUBLIC_WS_BASE_URL=wss://…`
- [ ] `PRISM_CORS_ORIGINS` = exact frontend origin(s)
- [ ] `PRISM_TRUST_PROXY_HEADERS=true` only behind a proxy that overwrites `X-Forwarded-For`. Set uvicorn `FORWARDED_ALLOW_IPS` to the proxy network
- [ ] Secrets (DB password, Redis auth/TLS URL, metrics token) from a secret manager, never in images or git
- [ ] `/metrics` restricted at the ingress or via `PRISM_METRICS_TOKEN`. `/docs` is disabled in production
- [ ] Redis with AUTH + TLS, not internet-reachable, `maxmemory-policy noeviction`
- [ ] `alembic upgrade head` in the release step. `PRISM_DB_AUTO_CREATE=false` (enforced)
- [ ] Dependency scanning (`pip-audit`, `npm audit`) in CI. Pinned versions. Rebuild images on base-image CVEs
- [ ] First admin granted via the CLI by a named operator. Review the audit log regularly
- [ ] Retention job scheduled. Backups encrypted (OPERATIONS.md)
- [ ] Abuse response: moderators on rota for `priority: high` reports. Escalation path for child-safety reports to the relevant authorities per your jurisdiction (a legal and policy decision outside this codebase)
