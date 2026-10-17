import type { RoomId } from "@/lib/api/types";
import { backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from "./backoff";
import { RecentIds } from "./dedupe";
import {
  parseServerEvent,
  type AckData,
  type AckError,
  type ClientCommandMap,
  type ClientCommandType,
  type ServerEvent,
} from "./events";

export type RealtimeStatus = "idle" | "connecting" | "open" | "reconnecting" | "failed" | "closed";

/** Minimal WebSocket surface so tests and the mock server can supply their own. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** Creates a socket; for HTTP mode this first fetches a single-use ticket. */
export type SocketFactory = (signal: AbortSignal) => Promise<SocketLike>;

export class RealtimeError extends Error {
  constructor(
    readonly code: AckError["code"] | "offline" | "timeout" | "network",
    message: string,
  ) {
    super(message);
    this.name = "RealtimeError";
  }
}

/** Close codes the backend uses to say "do not retry". */
const TERMINAL_CLOSE_CODES = new Set([4403, 4409]);
const OPEN = 1;

interface PendingAck {
  resolve: (data: unknown) => void;
  reject: (err: RealtimeError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RealtimeOptions {
  backoff?: BackoffOptions;
  ackTimeoutMs?: number;
  random?: () => number;
  newId?: () => string;
}

/**
 * A single multiplexed realtime connection with:
 * - bounded exponential backoff + jitter, then a terminal "failed" state,
 * - duplicate-event suppression by envelope id,
 * - per-room sequence tracking and resync on gaps or reconnects,
 * - command acks with timeouts (commands are never silently replayed; callers
 *   decide whether a retry is safe, e.g. chat retries reuse clientMsgId).
 */
export class RealtimeConnection {
  status: RealtimeStatus = "idle";
  attempt = 0;
  /** Estimated server clock minus local clock, in ms. */
  serverOffsetMs = 0;

  private socket: SocketLike | null = null;
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private openAbort: AbortController | null = null;
  private hasOffsetSample = false;
  private readonly pending = new Map<string, PendingAck>();
  private readonly listeners = new Set<(event: ServerEvent) => void>();
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();
  private readonly recent = new RecentIds(1000);
  private readonly lastSeq = new Map<RoomId, number>();
  private readonly rooms = new Map<RoomId, number>(); // roomId -> subscriber count
  private readonly backoff: BackoffOptions;
  private readonly ackTimeoutMs: number;
  private readonly random: () => number;
  private readonly newId: () => string;

  constructor(private readonly factory: SocketFactory, opts: RealtimeOptions = {}) {
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 10_000;
    this.random = opts.random ?? Math.random;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  /* ------------------------------ lifecycle ------------------------------ */

  connect(): void {
    if (this.status === "open" || this.status === "connecting" || this.status === "reconnecting") return;
    this.manualClose = false;
    this.attempt = 0;
    void this.open();
  }

  /** Manual retry after "failed", or when the browser comes back online. */
  retryNow(): void {
    if (this.status === "open" || this.manualClose) return;
    this.clearReconnectTimer();
    this.attempt = 0;
    void this.open();
  }

  close(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.openAbort?.abort();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "client closing");
    this.rejectPending("network", "Connection closed");
    this.setStatus("closed");
  }

  private async open(): Promise<void> {
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    this.openAbort?.abort();
    const abort = new AbortController();
    this.openAbort = abort;
    let socket: SocketLike;
    try {
      socket = await this.factory(abort.signal);
    } catch {
      if (abort.signal.aborted || this.manualClose) return;
      this.scheduleReconnect();
      return;
    }
    if (abort.signal.aborted || this.manualClose) {
      socket.close(1000, "superseded");
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus("open");
      // Resubscribe every room; the server answers with a fresh snapshot.
      for (const roomId of this.rooms.keys()) this.sendSubscribe(roomId);
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket) this.handleFrame(ev.data);
    };
    socket.onerror = () => {
      /* onclose follows and owns reconnection */
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.rejectPending("network", "Connection lost");
      if (this.manualClose) {
        this.setStatus("closed");
      } else if (TERMINAL_CLOSE_CODES.has(ev.code)) {
        this.setStatus("failed");
      } else {
        this.scheduleReconnect();
      }
    };
    // Sockets that are already open (e.g. in-memory mock) won't fire onopen.
    if (socket.readyState === OPEN) socket.onopen?.({});
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    const delay = backoffDelay(this.attempt, this.backoff, this.random);
    if (delay === null) {
      this.setStatus("failed");
      return;
    }
    this.setStatus("reconnecting");
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  /* ------------------------------ inbound ------------------------------ */

  private handleFrame(data: unknown): void {
    const event = parseServerEvent(data);
    if (!event) return;
    if (!this.recent.add(event.id)) return; // duplicate delivery

    this.sampleClock(event.ts);

    if (event.type === "ack") {
      const entry = this.pending.get(event.payload.replyTo);
      if (!entry) return;
      this.pending.delete(event.payload.replyTo);
      clearTimeout(entry.timer);
      if (event.payload.ok) entry.resolve(event.payload.data);
      else entry.reject(new RealtimeError(event.payload.error.code, event.payload.error.message));
      return;
    }

    if (event.roomId && event.seq !== undefined) {
      const last = this.lastSeq.get(event.roomId);
      if (event.type === "room.snapshot") {
        this.lastSeq.set(event.roomId, event.seq);
      } else if (last !== undefined && event.seq <= last) {
        return; // stale or replayed
      } else {
        if (last !== undefined && event.seq > last + 1 && this.rooms.has(event.roomId)) {
          // Missed events: apply this one, then ask for an authoritative snapshot.
          this.sendSubscribe(event.roomId);
        }
        this.lastSeq.set(event.roomId, event.seq);
      }
    }

    for (const listener of this.listeners) listener(event);
  }

  private sampleClock(ts: string): void {
    const serverMs = Date.parse(ts);
    if (!Number.isFinite(serverMs)) return;
    const sample = serverMs - Date.now();
    this.serverOffsetMs = this.hasOffsetSample ? this.serverOffsetMs * 0.8 + sample * 0.2 : sample;
    this.hasOffsetSample = true;
  }

  /* ------------------------------ outbound ------------------------------ */

  send<K extends ClientCommandType>(type: K, payload: ClientCommandMap[K]): Promise<AckData<K>> {
    const socket = this.socket;
    if (!socket || this.status !== "open") {
      return Promise.reject(new RealtimeError("offline", "Not connected"));
    }
    const id = this.newId();
    return new Promise<AckData<K>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RealtimeError("timeout", "The server didn't respond in time"));
      }, this.ackTimeoutMs);
      this.pending.set(id, { resolve: resolve as (d: unknown) => void, reject, timer });
      try {
        socket.send(JSON.stringify({ id, type, payload }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new RealtimeError("network", "Failed to send"));
      }
    });
  }

  private sendSubscribe(roomId: RoomId): void {
    const lastSeq = this.lastSeq.get(roomId);
    this.send("room.subscribe", { roomId, lastSeq }).catch(() => {
      /* reconnect flow will retry */
    });
  }

  /** Reference-counted room subscription. Returns an unsubscribe function. */
  subscribeRoom(roomId: RoomId): () => void {
    const count = this.rooms.get(roomId) ?? 0;
    this.rooms.set(roomId, count + 1);
    if (count === 0 && this.status === "open") this.sendSubscribe(roomId);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const current = this.rooms.get(roomId) ?? 1;
      if (current <= 1) {
        this.rooms.delete(roomId);
        this.lastSeq.delete(roomId);
        if (this.status === "open") this.send("room.unsubscribe", { roomId }).catch(() => {});
      } else {
        this.rooms.set(roomId, current - 1);
      }
    };
  }

  private rejectPending(code: RealtimeError["code"], message: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new RealtimeError(code, message));
      this.pending.delete(id);
    }
  }

  /* ------------------------------ observers ------------------------------ */

  on(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  serverNow(): number {
    return Date.now() + this.serverOffsetMs;
  }
}
