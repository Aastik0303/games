# Redis key schema

All keys use the prefix `prism:v1:`. Bump `v1` for incompatible changes so old and new keys can coexist during a rollout. `{…}` is a Cluster hash tag. Source of truth: `app/redis/keys.py`.

| Key | Type | Contents | TTL / cleanup |
|---|---|---|---|
| `sess:<sha256(token)>` | STRING | `{uid, exp}`. The token itself is never stored | `session_ttl_sec` (2 h), extended by refresh |
| `user:<uid>:sessions` | SET | session digests (for revoke-all on suspend/sign-out) | session TTL |
| `wst:<sha256(ticket)>` | STRING | `{uid, sess}` single-use WS ticket, consumed with `GETDEL` | 30 s |
| `{room:<id>}:doc` | HASH `{v, d}` | room + private meta + live game runtime + watch state (CAS) | 6 h idle, refreshed on every write; 10 min after close |
| `{room:<id>}:seq` | STRING | per-room event sequence | room TTL |
| `{room:<id>}:chat` | LIST | last 200 messages | room TTL; 10 min after close |
| `{room:<id>}:presence` | ZSET | `uid\|conn` scored by heartbeat expiry (ms) | entries expire via sweeper; key has room TTL |
| `{room:<id>}:idem:<uid>:<key>` | STRING | chat `clientMsgId` → message id; WS command id → cached ack | 10 min |
| `roomcode:<CODE>` | STRING | room id | room TTL; deleted on close |
| `rooms:active` | ZSET | room id by last activity | pruned by sweeper |
| `user:<uid>:rooms` | SET | rooms the user is in | room TTL |
| `ev:room:<id>` / `ev:user:<uid>` | Pub/Sub channels | versioned event envelopes | n/a |
| `solo:<id>` | HASH `{v, d}` | solo session: seed, content version, dealt item ids, counters | 2 h |
| `mm:{seg:<g>:<lang>:<size>:<age>}:q` | ZSET | ticket id by enqueue time (ms) | ticket TTL + 10 min |
| `mm:{seg:…}:t:<ticket>` | HASH | user, criteria, enq, status, phase, op, room_code | ticket TTL + 10 min |
| `mm:{seg:…}:claims` | HASH | op id → `{tickets, at}` in-flight claims (crash recovery) | removed on finish/release |
| `mm:ticket:<ticket>` | STRING | segment (lookup) | ticket TTL + 10 min |
| `mm:user:<uid>` | STRING | user's active ticket (one per user) | ticket TTL + 10 min |
| `mm:op:<op>` | STRING | room id for a match op (`SET NX` = no duplicate rooms) | 1 h |
| `mm:segments` | SET | known segments (bounded: games × languages × sizes × 2) | permanent, small |
| `{timers}:due` / `{timers}:inflight` | ZSET | timer jobs by due time / lease expiry | jobs removed when run |
| `rl:<policy>:<subject>` | STRING | fixed-window counter | the policy window |
| `idem:<uid>:<scope>:<key>` | STRING | REST `Idempotency-Key` result | 10 min |
| `online` | ZSET | uid by last heartbeat (aggregate counts only) | pruned after 24 h |
| `lock:sweeper` | STRING | sweeper leader for one interval | 4 s |
| `m:matches:<YYYYMMDDHH>`, `m:matches:<game>:<hour>` | STRING | hourly match counters | 26 h |
| `m:wait:<game>:samples` | LIST | last 200 match waits (s) | capped |

A test (`tests/test_presence_ttl.py::test_ephemeral_keys_all_have_ttls`) asserts every key except the listed global indexes has a TTL.

## Lua scripts (`app/redis/scripts.py`)

| Script | Keys | Guarantees |
|---|---|---|
| `CAS_SET` | doc | write only if version matches. Basis of all room/solo updates |
| `PUBLISH_SEQ` | room seq | `INCR` + `PUBLISH` atomically: seq order = publish order |
| `RATE_LIMIT` | counter | atomic fixed-window count + expiry |
| `CLAIM_TICKETS` | queue + tickets (one slot) | all tickets still queued → claim all, else claim none |
| `RELEASE_TICKETS` / `FINISH_TICKETS` | same | only touch tickets still claimed by this op |
| `CANCEL_TICKET` | queue + ticket | cancel only if not already claimed or matched |
| `CLAIM_TIMERS` / `REQUEUE_TIMERS` | `{timers}` | exactly-one claim with a lease; expired leases requeue |

No passwords or secrets are stored. Media bytes are never stored.
