# Prism — frontend

A responsive social puzzle and Watch Together platform: solo puzzles, matchmaking, private rooms with live games and chat, synced video, and an admin dashboard.

Built with Next.js 16 (App Router, Cache Components), TypeScript (strict), Tailwind CSS 4, Radix Dialog and Lucide icons. Tests use Vitest and Testing Library.

> **Status:** the frontend is complete against a typed contract. Out of the box it runs on an **in-browser mock server** that shows a visible **Mock data** badge. It is **not connected to a real backend** until you point it at one — see [Connecting the real backend](#connecting-the-real-backend).

## Quick start

Requirements: Node 20.19+ and npm 10.

```bash
npm install
cp .env.example .env.local      # optional; dev defaults to mock mode
npm run dev                     # http://localhost:3000
```

In mock mode:

1. Create a profile.
2. Try the solo games, or **Find players**. Matchmaking forms a room with labelled mock players.
3. In a private room you create, use **Host controls → Add mock player**. Nobody else can reach an in-memory room.
4. Turn on **Settings → Developer → Mock admin role** to preview `/admin`.

The same Developer section can simulate a connection drop or an expired session.

Mock rooms live in the tab's memory. They reset on a full page reload; the profile survives in `sessionStorage`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Vitest (unit, component and mock-pipeline tests) |
| `npm run typecheck` | Generate route types and run `tsc --noEmit` |
| `npm run lint` | ESLint (Next core-web-vitals and React Compiler rules) |
| `npm run check` | Type-check, lint and test |

## Configuration

See `.env.example`. Every variable is `NEXT_PUBLIC_*`, so it is public. There are no secrets in the frontend.

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_MODE` | `mock` in dev, `http` in prod | Production builds ignore `mock` unless `NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION=true` |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | FastAPI origin |
| `NEXT_PUBLIC_WS_BASE_URL` | derived from the API URL | The real socket URL comes from `POST /v1/realtime/tickets` |

## Architecture

- **One API surface.** Components import `api` from `@/lib/api`, typed by `PrismApi` (`src/lib/api/client.ts`). The mock backend is loaded through the `prism-mock-runtime` alias. For http builds, `next.config.ts` points that alias at an empty stub, so the mock server and fixtures never ship; this was checked by searching the production bundle for fixture strings. UI code never imports fixtures. Dev-only extras go through `mockDev`, which is `null` in http mode.
- **The server is authoritative.** Puzzles reach the browser without answers. Grading, scores, turns, timers, host rights and membership come from the server. The client may highlight sudoku conflicts because the rules are public, but correctness is decided by the server.
- **Realtime.** `RealtimeConnection` (`src/lib/realtime/connection.ts`) handles:
  - single-use ticket fetch,
  - bounded exponential backoff with jitter, then a terminal "failed" state with manual retry,
  - reconnect on the browser `online` event,
  - duplicate-event suppression by id,
  - per-room `seq` gap detection with resync,
  - command acks with timeouts.

  Commands are never replayed automatically. Chat retries reuse `clientMsgId` so the server can de-duplicate.
- **Optimistic UI only where safe.** Chat shows a "Sending…" bubble that is reconciled with the server echo. Privacy toggles update optimistically. Ready status, host actions and answers wait for the server.
- **Cancellation.** Every API call takes an `AbortSignal`. `useApiQuery` aborts on unmount or key change and keeps stale data during refreshes. The HTTP adapter adds a 15 s timeout.
- **Session expiry.** Any 401 emits `sessionEvents.expired`. The app drops the socket and shows a "session ended" dialog. The session refreshes about 2 minutes before `expiresAt`.
- **Next 16 Activity.** Visited routes stay mounted but hidden. `FreshOnNavigate` (which keys on `router.bfcacheId`) resets forms and live screens on fresh navigations. Effects clean up when a route is hidden: the video pauses, room subscriptions end and matchmaking is cancelled.

More detail: [docs/ROUTES.md](docs/ROUTES.md) for the route/component map, [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for REST, WebSocket and the server rules.

## Design system

Tokens live in `src/app/globals.css` (`@theme`):

- ink surfaces and text tokens tuned for ≥4.5:1 contrast,
- violet, cyan and magenta accents,
- `glass` / `glass-strong` / `prism-edge` / `prism-text` utilities.

Components live in `src/components/ui`. Accessibility:

- visible `:focus-visible` rings everywhere,
- reduced motion follows the OS, with an in-app override (System / Reduced / Full),
- large-text and high-contrast modes (also honours `prefers-contrast`),
- skip link, labelled controls, live regions for chat, timers, toasts and results,
- game state never shown by colour alone.

## Testing

- `npm test` runs 54 tests. They cover:
  - the profile form: validation, under-13 block, no gender field, interests consent,
  - join-code validation,
  - the room reducer: version ordering, chat reconciliation,
  - lobby rules and the `Lobby` host/player views,
  - the three game engines,
  - the matchmaking reducer: stale tickets,
  - the realtime client: dedupe, acks, backoff, terminal codes, seq gaps,
  - the HTTP adapter: 401/429/5xx/abort,
  - mock-server rules: no leaked answers, grading, minor defaults, admin 403, host-only commands,
  - an end-to-end mock pipeline test (create room → socket → bot → start → graded answer).
- Browser flows were also exercised in Edge via Playwright during development. That script is not part of this repo; adding Playwright e2e to CI is a recommended next step.

## Known gaps (honest list)

- **No real backend yet.** Every network feature runs against the mock until the FastAPI service implements `docs/API_CONTRACT.md`.
- **Screen share is a local preview.** `getDisplayMedia` capture, consent, stop and the indicator are real. Sending the stream to others needs WebRTC signalling plus an SFU, which isn't built. The UI says so.
- **No voice or video chat.** Audio settings cover UI sounds and media volume only.
- **Multiplayer games:** Missing Word (simultaneous) and Riddle Relay (turn-based). Mini Grid and the mystery case are solo only.
- **Content:** a small fixture set (10 word puzzles, 10 riddles, 6 grids, 1 mystery). Real content comes from the backend catalog.
- **Admin** manages availability, flags and reports. It has no content authoring, user search or audit-log viewer yet.
- **No CSP header yet.** It needs nonce plumbing for Next's inline scripts. Other security headers are set in `next.config.ts`.
- **i18n:** UI copy is English only; the language preference is used for matching.
- **Chat moderation** depends on the server. The client only hides messages from players you've blocked.

## Connecting the real backend

1. Implement the endpoints and WebSocket protocol in `docs/API_CONTRACT.md`. `src/lib/api/mock/server.ts` is an executable reference for every rule.
2. Configure the backend:
   - CORS for the frontend origin with `allow_credentials=True`,
   - an HttpOnly `Secure` `SameSite=Lax` session cookie,
   - a check for `X-Prism-Client: web` and `Origin` on mutating requests.
3. Have `POST /v1/realtime/tickets` return `{ url: "wss://api.example.com/v1/ws?ticket=…", expiresAt }`. Make the ticket single-use, short-lived and tied to the session.
4. Set the frontend environment:
   ```bash
   NEXT_PUBLIC_API_MODE=http
   NEXT_PUBLIC_API_BASE_URL=https://api.example.com
   ```
5. Run `npm run build && npm start`. The **Mock data** badge and all Developer tools disappear in http mode.
6. Smoke test, in order:
   1. profile create, then reload (session cookie persists),
   2. solo game (answers graded),
   3. create room,
   4. second browser joins by code,
   5. ready → start → answers,
   6. chat and report,
   7. kill the API to see the reconnect banner,
   8. `/admin` with and without the admin role (expect a 403 page).
