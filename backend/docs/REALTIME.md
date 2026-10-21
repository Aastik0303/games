# Realtime (WebSocket) contract

Implements the protocol in `frontend/src/lib/realtime/events.ts`. One socket per tab, multiplexed across rooms and matchmaking tickets.

## Connecting

1. `POST /v1/realtime/tickets` (cookie-authenticated) → `{url, expiresAt}`. The ticket is random, single-use (`GETDEL`), and valid for 30 s. Only its hash is stored.
2. Open `url` (`wss://…/v1/ws?ticket=…`). The server checks the `Origin` against the CORS allowlist and rate-limits connects per IP before accepting.
3. Every command re-checks that the session still exists (at most every 5 s), and so does the heartbeat. Sign-out, suspension or expiry closes the socket with **4401**.

| Close code | Meaning | Client action (connection.ts) |
|---|---|---|
| 4401 | ticket/session invalid | fetch a new ticket and retry |
| 4403 | forbidden (e.g. origin) | stop |
| 1003 / 1009 / 1008 | binary frame / frame > 16 KiB / repeated abuse | backoff + retry |
| 1012 | server restarting | backoff + retry (lands on another instance) |
| 1013 | overloaded or slow consumer | backoff + retry |

## Frames

Client → server: `{"id": "<≤64 chars>", "type": "<command>", "payload": {…}}`. Every frame is validated in this order: size, JSON, envelope, per-type payload model (unknown fields rejected), per-socket rate (40 commands per 10 s), session liveness, membership and role, domain rules. Each command gets **exactly one** `ack`:

```json
{"id":"…","type":"ack","ts":"…","payload":{"replyTo":"<command id>","ok":true,"data":{…}}}
{"id":"…","type":"ack","ts":"…","payload":{"replyTo":"<command id>","ok":false,"error":{"code":"forbidden","message":"Only the host can start"}}}
```

Server → client events: `{id, type, ts, payload, v: 1, roomId?, seq?}`. `v` is the event schema version.

| Command | Who | Effect / events |
|---|---|---|
| `room.subscribe {roomId, lastSeq?}` | member | ack, then `room.snapshot` (with current `seq`) and presence → online |
| `room.unsubscribe` | member | presence → reconnecting if no other socket |
| `room.set_ready {ready}` | member, lobby | `room.updated` |
| `room.update_settings {activity?, capacity?, privacy?}` | host, lobby | `room.updated` (ready states reset if the activity changed) |
| `room.kick {userId}` | host | `room.updated`; target gets `room.removed {reason:"kicked"}` and is banned from rejoining |
| `room.start` | host | game: `room.updated` + `game.state` (countdown). Watch: `watch.state` |
| `room.end_activity` | host | back to lobby, `room.updated` |
| `chat.send {clientMsgId, text}` | member | `chat.message`. Idempotent by `clientMsgId`. 5 per 10 s. Links stripped in minor rooms and for strict filters. Blocked authors are hidden per recipient |
| `reaction.send {reaction}` | member | `reaction` (6 allowed emoji, 8 per 10 s) |
| `game.submit {round, answer}` | member (on turn) | ack `data: {correct, attemptsLeft}`. `game.state` when someone scores |
| `watch.set_source {source}` | host | `watch.state`. https + host allowlist + video extension |
| `watch.control {action, positionSec}` | host | `watch.state` with server `updatedAt` |
| `matchmaking.watch {ticketId}` | ticket owner | current `matchmaking.status` / `matchmaking.matched` |

Private events (`room.removed`, `matchmaking.*`, `moderation.notice`) go to the user's own channel, never to the room. Moderation notes and report details are never sent to players. Answer keys are never in `game.state` until `lastReveal`.

## Delivery guarantees and recovery

- **Transport:** Redis Pub/Sub, which is **at-most-once**. If an instance's subscriber connection drops, events published meanwhile are lost for its sockets.
- **Ordering:** `seq` is assigned and published inside one Lua script, so per-room order is total. Sockets receive events in `seq` order.
- **Recovery:**
  1. Every room event carries `seq`. The client drops `seq ≤ last` (duplicates or stale), and on a gap re-sends `room.subscribe`. The server answers with an authoritative snapshot.
  2. On subscribe the server buffers that room's live events until the snapshot is sent, then flushes only events with `seq > snapshot.seq`. No event slips between snapshot and stream.
  3. When an instance's listener reconnects to Redis, it proactively pushes fresh snapshots to all its sockets.
  4. Every event carries a unique `id` for client-side dedupe, so at-least-once redelivery would also be safe.
- **Why Pub/Sub and not Streams:** all room state is snapshot-able and every event carries full state for its object (room, game state, watch state), so replay isn't needed. Streams would add consumer-group bookkeeping per instance for no gain in correctness. Chat is the one append-only feed, and its last 200 messages are in the snapshot.
- **Commands are at-most-once per id:** a repeated command id on the same socket gets the cached ack. Mutating commands are also deduplicated across sockets for 10 min (Redis), so a client retrying after a reconnect can't double-submit an answer or double-kick.
- **Presence:** sockets heartbeat every 15 s (TTL 45 s). A disconnect marks the member `reconnecting`. After `reconnect_grace_sec` (120 s) they become `offline`. The room survives temporary disconnects. The host role moves to an online member after `host_transfer_after_sec` (90 s). A room with nobody online for `room_abandon_after_sec` (10 min) is closed (`room.closed {reason:"expired"}`).
- **Backpressure:** each socket has a 256-frame send queue. A client that can't keep up is closed with 1013 and resyncs on reconnect, instead of stalling the instance.

## Example client usage

The frontend already implements this in `src/lib/realtime/connection.ts`. To switch the frontend from mock to the real backend:

```bash
# frontend/.env.local
NEXT_PUBLIC_API_MODE=http
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

A minimal standalone client (TypeScript):

```ts
const { url } = await fetch(`${API}/v1/realtime/tickets`, {
  method: "POST", credentials: "include", headers: { "X-Prism-Client": "web" },
}).then((r) => r.json());
const ws = new WebSocket(url);
let lastSeq = 0;
ws.onopen = () => ws.send(JSON.stringify({ id: crypto.randomUUID(), type: "room.subscribe", payload: { roomId } }));
ws.onmessage = ({ data }) => {
  const ev = JSON.parse(data);
  if (ev.type === "room.snapshot") lastSeq = ev.seq;
  else if (ev.seq !== undefined) {
    if (ev.seq <= lastSeq) return;            // duplicate/stale
    if (ev.seq > lastSeq + 1) resubscribe();  // gap: ask for a snapshot
    lastSeq = ev.seq;
  }
  render(ev);
};
ws.onclose = (e) => (e.code === 4401 ? reconnectWithNewTicket() : e.code >= 4400 && e.code < 4500 ? showLost() : backoff());
```
