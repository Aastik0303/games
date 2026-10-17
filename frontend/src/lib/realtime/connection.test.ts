import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, DEFAULT_BACKOFF } from "./backoff";
import { RealtimeConnection, type SocketLike } from "./connection";
import { RecentIds } from "./dedupe";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: { id: string; type: string; payload: Record<string, unknown> }[] = [];
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  emit(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ ts: new Date().toISOString(), ...frame }) });
  }
}

function setup(opts: { maxAttempts?: number } = {}) {
  const sockets: FakeSocket[] = [];
  const factory = vi.fn(async () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  });
  let n = 0;
  const conn = new RealtimeConnection(factory, {
    backoff: { ...DEFAULT_BACKOFF, maxAttempts: opts.maxAttempts ?? 3, jitter: 0 },
    newId: () => `cmd-${++n}`,
    ackTimeoutMs: 1000,
  });
  return { conn, sockets, factory };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("backoffDelay", () => {
  it("grows exponentially, caps at maxMs, and stops after maxAttempts", () => {
    const opts = { baseMs: 500, maxMs: 4000, jitter: 0, maxAttempts: 5 };
    expect([1, 2, 3, 4, 5].map((a) => backoffDelay(a, opts))).toEqual([500, 1000, 2000, 4000, 4000]);
    expect(backoffDelay(6, opts)).toBeNull();
    expect(backoffDelay(0, opts)).toBeNull();
  });

  it("keeps jittered delays within ±jitter of the base value", () => {
    const opts = { baseMs: 1000, maxMs: 10_000, jitter: 0.3, maxAttempts: 3 };
    expect(backoffDelay(1, opts, () => 0)).toBe(700);
    expect(backoffDelay(1, opts, () => 0.999999)).toBe(1300);
  });
});

describe("RecentIds", () => {
  it("rejects duplicates and evicts the oldest beyond capacity", () => {
    const ids = new RecentIds(2);
    expect(ids.add("a")).toBe(true);
    expect(ids.add("a")).toBe(false);
    ids.add("b");
    ids.add("c");
    expect(ids.add("a")).toBe(true); // evicted, so seen as new
  });
});

describe("RealtimeConnection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers each event id once even if the server repeats it", async () => {
    const { conn, sockets } = setup();
    const seen: string[] = [];
    conn.on((e) => seen.push(e.id));
    conn.connect();
    await flush();
    sockets[0].open();
    const frame = { id: "evt-1", type: "reaction", roomId: "r1", payload: { roomId: "r1", userId: "u", reaction: "🔥" } };
    sockets[0].emit(frame);
    sockets[0].emit(frame);
    expect(seen).toEqual(["evt-1"]);
  });

  it("resolves commands with their ack and rejects on error acks", async () => {
    const { conn, sockets } = setup();
    conn.connect();
    await flush();
    sockets[0].open();
    const ok = conn.send("room.set_ready", { roomId: "r1", ready: true });
    const bad = conn.send("room.start", { roomId: "r1" });
    sockets[0].emit({ id: "a1", type: "ack", payload: { replyTo: "cmd-1", ok: true } });
    sockets[0].emit({ id: "a2", type: "ack", payload: { replyTo: "cmd-2", ok: false, error: { code: "forbidden", message: "Only the host can start" } } });
    await expect(ok).resolves.toBeUndefined();
    await expect(bad).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects immediately when offline instead of queueing commands", async () => {
    const { conn } = setup();
    await expect(conn.send("room.start", { roomId: "r1" })).rejects.toMatchObject({ code: "offline" });
  });

  it("reconnects with backoff, resubscribes rooms, and fails after the attempt limit", async () => {
    const { conn, sockets, factory } = setup({ maxAttempts: 2 });
    const statuses: string[] = [];
    conn.onStatus((s) => statuses.push(s));
    conn.subscribeRoom("r1");
    conn.connect();
    await flush();
    sockets[0].open();
    expect(sockets[0].sent.map((c) => c.type)).toEqual(["room.subscribe"]);

    sockets[0].drop();
    expect(conn.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(499);
    expect(factory).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(factory).toHaveBeenCalledTimes(2);
    sockets[1].open();
    expect(sockets[1].sent[0]).toMatchObject({ type: "room.subscribe", payload: { roomId: "r1" } });

    // Two more drops without a successful open exhaust the budget.
    sockets[1].drop();
    await vi.advanceTimersByTimeAsync(500);
    sockets[2].drop();
    await vi.advanceTimersByTimeAsync(1000);
    sockets[3]?.drop();
    expect(conn.status).toBe("failed");
    expect(statuses).toContain("failed");
  });

  it("does not retry after a terminal close code", async () => {
    const { conn, sockets, factory } = setup();
    conn.connect();
    await flush();
    sockets[0].open();
    sockets[0].drop(4403);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(conn.status).toBe("failed");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("drops stale sequence numbers and resyncs on a gap", async () => {
    const { conn, sockets } = setup();
    const types: number[] = [];
    conn.on((e) => e.seq !== undefined && types.push(e.seq));
    conn.subscribeRoom("r1");
    conn.connect();
    await flush();
    sockets[0].open();
    const ev = (id: string, seq: number) => ({ id, seq, roomId: "r1", type: "presence.changed", payload: { roomId: "r1", userId: "u", connection: "online" } });
    sockets[0].emit(ev("e5", 5));
    sockets[0].emit(ev("e4", 4)); // stale
    sockets[0].emit(ev("e8", 8)); // gap → resubscribe
    expect(types).toEqual([5, 8]);
    expect(sockets[0].sent.filter((c) => c.type === "room.subscribe")).toHaveLength(2);
    expect(sockets[0].sent.at(-1)).toMatchObject({ payload: { roomId: "r1", lastSeq: 5 } });
  });
});
