# Prism API contract (frontend view)

The source of truth for shapes is TypeScript:

- REST surface: `src/lib/api/client.ts` (`PrismApi`), payloads in `src/lib/api/types.ts`
- Realtime protocol: `src/lib/realtime/events.ts`
- Reference behaviour: `src/lib/api/mock/server.ts`. It enforces the same rules the backend must (membership, host rights, turn order, grading, rate limits, minor defaults).

The FastAPI backend should mirror these as Pydantic models. Every rule here is **enforced by the server**. The client only reflects it.

## Conventions

- Base path `/v1`. JSON in and out.
- **Auth:** an HttpOnly, `Secure`, `SameSite=Lax` session cookie set by `POST /v1/session`. The browser never sees a token. Requests use `credentials: "include"`, so CORS must allow the frontend origin with credentials.
- **CSRF:** every request sends `X-Prism-Client: web`. Reject state-changing requests that lack it or that have a foreign `Origin`.
- **Errors:** `{"error": {"code": "...", "message": "...", "fields": {"field": "msg"}}}`, with these status codes:
  - `401`: `session_expired` / `unauthorized`. The client drops its session and shows "session ended".
  - `403`: `forbidden`
  - `404`: `not_found`
  - `409`: `conflict` or `room_full`
  - `422`: `validation` (with `fields`)
  - `429`: `rate_limited`, with a `Retry-After` header
  - `5xx`: the message is never shown to users.
- `GET /v1/session` returns `401` when nobody is signed in. The client treats that one as anonymous, not as an expiry.

## REST endpoints

| Method & path | Body → Response |
|---|---|
| `GET /v1/session` | → `Session` (401 = anonymous) |
| `POST /v1/session` | `{profile: ProfileInput}` → `Session` (sets cookie; server derives `isMinor`) |
| `PUT /v1/session/profile` | `{profile}` → `Session` |
| `POST /v1/session/refresh` | → `Session` (client calls ~2 min before `expiresAt`) |
| `DELETE /v1/session` | → 204 (sign out and delete session-scoped data) |
| `GET/PUT /v1/me/privacy` | `PrivacySettings` (minors forced to `strict` / `matched_only`) |
| `GET /v1/config/flags` | → `FeatureFlags` |
| `GET /v1/community/pulse` | → `CommunityPulse` (coarse numbers are fine; `null` to hide) |
| `GET /v1/games`, `GET /v1/games/{id}` | → `GameSummary[]` / `GameSummary` (enabled only) |
| `POST /v1/solo/sessions` | `{gameId, difficulty}` → `SoloSession` (**no answers in `puzzle`**) |
| `POST /v1/solo/sessions/{id}/answers` | `{answer: PuzzleAnswer}` → `AnswerResult` (`solution` only once closed) |
| `POST /v1/solo/sessions/{id}/hints` | → `{hint, hintsLeft}` |
| `POST /v1/solo/sessions/{id}/clues/{clueId}` | → `RevealedClue` |
| `POST /v1/solo/sessions/{id}/advance` | → `SoloSession` (skips if the current puzzle is open) |
| `POST /v1/rooms` | `CreateRoomInput` → `Room` (server generates an 8-char code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`) |
| `GET /v1/rooms/{code}` | → `Room` |
| `POST /v1/rooms/{code}/join` | → `Room` (idempotent for members; rate-limit per user+IP to stop code guessing) |
| `POST /v1/rooms/by-id/{roomId}/leave` | → 204 (host leaving closes the room in the reference implementation) |
| `POST /v1/matchmaking/tickets` | `MatchCriteria` → `MatchTicket` |
| `DELETE /v1/matchmaking/tickets/{id}` | → 204 |
| `POST /v1/realtime/tickets` | → `{url, expiresAt}`: single-use, short-lived WS URL, e.g. `wss://…/v1/ws?ticket=…` |
| `POST /v1/reports` | `ReportInput` → `{reportId}` |
| `PUT/DELETE /v1/blocks/{userId}`, `GET /v1/blocks` | block list |
| `GET /v1/admin/overview` | → `AdminOverview` (admin/moderator only) |
| `GET /v1/admin/games`, `PATCH /v1/admin/games/{id}` | catalog availability |
| `GET /v1/admin/reports?status=open\|actioned` | `actioned` = all resolved (actioned + dismissed) |
| `POST /v1/admin/reports/{id}/resolution` | `{action, note}` → `ModerationReport` (write an audit event) |
| `GET /v1/admin/flags`, `PUT /v1/admin/flags/{key}` | `{enabled}` → `FeatureFlag` |

## WebSocket protocol

One socket per browser tab. It is multiplexed across rooms and matchmaking tickets.

**Client → server command:** `{ "id": "<uuid>", "type": "<command>", "payload": {...} }`.
The server **must** answer every command with exactly one `ack`:

```json
{ "id": "<event uuid>", "type": "ack", "ts": "<ISO>", "payload": { "replyTo": "<command id>", "ok": true, "data": {} } }
{ "id": "...", "type": "ack", "ts": "...", "payload": { "replyTo": "...", "ok": false, "error": { "code": "forbidden", "message": "Only the host can start" } } }
```

**Server → client event envelope:** `{ id, type, ts, payload, roomId?, seq? }`

- `id` is unique per event. The client drops duplicates, so at-least-once delivery is safe.
- `seq` increases monotonically per room. The client drops stale values. When it sees a gap, it re-sends `room.subscribe` with `lastSeq` and expects a fresh `room.snapshot`.
- `ts` is the server time. The client uses it to estimate clock offset for timers and video sync.

On every (re)connect the client sends `room.subscribe` for each open room. The server replies with a `room.snapshot` that carries the room's current `seq`.

Commands (see `ClientCommandMap`): `room.subscribe`, `room.unsubscribe`, `room.set_ready`, `room.update_settings` (host), `room.kick` (host), `room.start` (host), `room.end_activity` (host), `chat.send` (idempotent by `clientMsgId`), `reaction.send`, `game.submit` (ack `data: {correct, attemptsLeft}`), `watch.set_source`, `watch.control`, `matchmaking.watch`.

Events (see `ServerEventMap`): `room.snapshot`, `room.updated`, `room.closed`, `room.removed`, `presence.changed`, `chat.message`, `chat.removed`, `reaction`, `game.state`, `watch.state`, `matchmaking.status`, `matchmaking.matched`, `error`.

Close codes: `4401` means the ticket or session is invalid; the client fetches a new ticket and retries. `4403` and `4409` are terminal; the client stops retrying and shows "Connection lost". Anything else triggers bounded exponential backoff with jitter: 0.5 s doubling to 15 s, 10 attempts. The client also retries immediately on the browser `online` event.

## Rules the backend must enforce

- Grade answers server-side. Never include `answers`, `solution` or clue `detail` before they are earned.
- Scores, `solvedBy`, turn order and timers (`endsAt`) are server-owned. Answers outside the round or turn are rejected (`not_your_turn`, `conflict`).
- Host-only commands check `room.hostId`. Every command checks membership.
- Chat: 1–300 chars, rate limit (reference: 5 per 10 s), filter links for `strict`, and drop messages from blocked users for the blocker.
- Minors: match only within minor age bands, keep `strict` chat and `matched_only` invites, and give `minor_safety` / `personal_info` reports high priority.
- Matchmaking ranks by activity, language, group size, accessibility needs and **queue time first**. It never ranks by protected traits.
- `watch.set_source`: https only. Apply a host allow-list and size/type checks as needed. Never proxy or decrypt DRM content.
