"""Lua scripts for every operation that must be atomic across workers.

Redis runs a script to completion before serving any other command, so each
script is a critical section. All keys passed to one script share a Cluster
hash tag (see keys.py).
"""

from __future__ import annotations

from typing import Any

from redis.asyncio import Redis

# Compare-and-set on a versioned document stored as HASH {v, d}.
# ARGV: expected version ("0" = must not exist), new json, ttl ms. Returns new version or -1.
CAS_SET = """
local cur = redis.call('HGET', KEYS[1], 'v')
local expected = tonumber(ARGV[1])
if expected == 0 then
  if cur then return -1 end
elseif (not cur) or tonumber(cur) ~= expected then
  return -1
end
local nv = expected + 1
redis.call('HSET', KEYS[1], 'v', nv, 'd', ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return nv
"""

# Assign the next per-room sequence number and publish in one step, so seq
# order equals publish order even when several workers publish at once.
# ARGV: channel, json object *without* its opening brace, ttl ms.
PUBLISH_SEQ = """
local seq = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('PUBLISH', ARGV[1], '{"seq":' .. seq .. ',' .. ARGV[2])
return seq
"""

# Fixed-window counter. ARGV: limit, window ms. Returns {count, pttl}.
RATE_LIMIT = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2])) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2])); ttl = tonumber(ARGV[2]) end
return {n, ttl}
"""

# Claim a group of matchmaking tickets atomically.
# KEYS[1] = queue zset, KEYS[2..] = ticket hashes. ARGV: op id, now ms, ticket ids...
# Succeeds only if every ticket is still queued; otherwise changes nothing.
CLAIM_TICKETS = """
local n = #KEYS - 1
for i = 1, n do
  local tid = ARGV[2 + i]
  if not redis.call('ZSCORE', KEYS[1], tid) then return 0 end
  if redis.call('HGET', KEYS[1 + i], 'status') ~= 'queued' then return 0 end
end
for i = 1, n do
  redis.call('ZREM', KEYS[1], ARGV[2 + i])
  redis.call('HSET', KEYS[1 + i], 'status', 'claimed', 'op', ARGV[1], 'claimed_at', ARGV[2])
end
return 1
"""

# Return claimed tickets to the queue (the match failed or its worker died).
# KEYS like CLAIM_TICKETS. ARGV: op id, ticket ids... Only touches tickets still claimed by this op.
RELEASE_TICKETS = """
local released = 0
for i = 1, #KEYS - 1 do
  local t = KEYS[1 + i]
  if redis.call('HGET', t, 'status') == 'claimed' and redis.call('HGET', t, 'op') == ARGV[1] then
    redis.call('HSET', t, 'status', 'queued')
    redis.call('HDEL', t, 'op', 'claimed_at')
    redis.call('ZADD', KEYS[1], tonumber(redis.call('HGET', t, 'enq')), ARGV[1 + i])
    released = released + 1
  end
end
return released
"""

# Mark claimed tickets matched (only if still claimed by this op).
# KEYS: ticket hashes. ARGV: op id, room code, room id.
FINISH_TICKETS = """
local done = 0
for i = 1, #KEYS do
  if redis.call('HGET', KEYS[i], 'status') == 'claimed' and redis.call('HGET', KEYS[i], 'op') == ARGV[1] then
    redis.call('HSET', KEYS[i], 'status', 'matched', 'room_code', ARGV[2], 'room_id', ARGV[3])
    done = done + 1
  end
end
return done
"""

# Cancel a ticket if it hasn't been claimed. KEYS: queue, ticket. ARGV: ticket id, new status.
CANCEL_TICKET = """
local st = redis.call('HGET', KEYS[2], 'status')
if st ~= 'queued' then return st or '' end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], 'status', ARGV[2])
return 'ok'
"""

# Move due timer jobs to the in-flight set with a lease. KEYS: due, inflight. ARGV: now, lease ms, limit.
CLAIM_TIMERS = """
local jobs = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[3]))
for _, job in ipairs(jobs) do
  redis.call('ZREM', KEYS[1], job)
  redis.call('ZADD', KEYS[2], tonumber(ARGV[1]) + tonumber(ARGV[2]), job)
end
return jobs
"""

# Requeue jobs whose lease expired (their worker died). KEYS: due, inflight. ARGV: now.
REQUEUE_TIMERS = """
local jobs = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
for _, job in ipairs(jobs) do
  redis.call('ZREM', KEYS[2], job)
  redis.call('ZADD', KEYS[1], tonumber(ARGV[1]), job)
end
return #jobs
"""

# Release a lock only if we still own it. KEYS: lock. ARGV: owner token.
RELEASE_LOCK = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""


class Scripts:
    """Registered scripts bound to one client (EVALSHA with automatic reload)."""

    def __init__(self, redis: Redis) -> None:
        reg = redis.register_script
        self.cas_set: Any = reg(CAS_SET)
        self.publish_seq: Any = reg(PUBLISH_SEQ)
        self.rate_limit: Any = reg(RATE_LIMIT)
        self.claim_tickets: Any = reg(CLAIM_TICKETS)
        self.release_tickets: Any = reg(RELEASE_TICKETS)
        self.finish_tickets: Any = reg(FINISH_TICKETS)
        self.cancel_ticket: Any = reg(CANCEL_TICKET)
        self.claim_timers: Any = reg(CLAIM_TIMERS)
        self.requeue_timers: Any = reg(REQUEUE_TIMERS)
        self.release_lock: Any = reg(RELEASE_LOCK)
