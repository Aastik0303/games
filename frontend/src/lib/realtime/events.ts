/**
 * Typed WebSocket protocol.
 *
 * Client → server messages are *commands*: `{ id, type, payload }`. The server
 * answers each with an `ack` whose `replyTo` equals the command id. Commands
 * are requests, not facts — the server validates membership, host rights,
 * turn order and answers, then broadcasts the resulting state.
 *
 * Server → client messages are *events* in an envelope with a unique `id`
 * (for duplicate suppression), an optional per-room `seq` (for gap detection)
 * and the server timestamp `ts` (for clock-offset estimation).
 */
import type {
  ChatMessage,
  ConnectionState,
  GameState,
  MatchPhase,
  PuzzleAnswer,
  Room,
  RoomActivity,
  RoomId,
  RoomPrivacy,
  UserId,
  WatchSource,
  WatchState,
} from "@/lib/api/types";

export const REACTIONS = ["👏", "🔥", "😂", "🤯", "💜", "🎉"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ClientCommandMap {
  "room.subscribe": { roomId: RoomId; lastSeq?: number };
  "room.unsubscribe": { roomId: RoomId };
  "room.set_ready": { roomId: RoomId; ready: boolean };
  "room.update_settings": {
    roomId: RoomId;
    activity?: RoomActivity;
    capacity?: number;
    privacy?: RoomPrivacy;
  };
  "room.kick": { roomId: RoomId; userId: UserId };
  "room.start": { roomId: RoomId };
  "room.end_activity": { roomId: RoomId };
  "chat.send": { roomId: RoomId; clientMsgId: string; text: string };
  "reaction.send": { roomId: RoomId; reaction: Reaction };
  "game.submit": { roomId: RoomId; round: number; answer: PuzzleAnswer };
  "watch.set_source": { roomId: RoomId; source: WatchSource };
  "watch.control": { roomId: RoomId; action: "play" | "pause" | "seek"; positionSec: number };
  "matchmaking.watch": { ticketId: string };
}

export type ClientCommandType = keyof ClientCommandMap;

export type ClientCommand = {
  [K in ClientCommandType]: { id: string; type: K; payload: ClientCommandMap[K] };
}[ClientCommandType];

export interface AckError {
  code: "forbidden" | "not_found" | "validation" | "rate_limited" | "conflict" | "not_your_turn" | "room_full" | "server";
  message: string;
}

/** Per-command ack payloads (data carried on success). */
export interface AckDataMap {
  "game.submit": { correct: boolean; attemptsLeft: number };
  "chat.send": { messageId: string };
}

export type AckData<K extends ClientCommandType> = K extends keyof AckDataMap ? AckDataMap[K] : undefined;

export interface ServerEventMap {
  ack: { replyTo: string; ok: true; data?: unknown } | { replyTo: string; ok: false; error: AckError };
  "room.snapshot": {
    room: Room;
    chat: ChatMessage[];
    game: GameState | null;
    watch: WatchState | null;
  };
  "room.updated": { room: Room };
  "room.closed": { roomId: RoomId; reason: "host_left" | "expired" | "moderation" };
  "room.removed": { roomId: RoomId; reason: "kicked" | "blocked" };
  "presence.changed": { roomId: RoomId; userId: UserId; connection: ConnectionState };
  "chat.message": { message: ChatMessage };
  "chat.removed": { roomId: RoomId; messageId: string };
  reaction: { roomId: RoomId; userId: UserId; reaction: Reaction };
  "game.state": { roomId: RoomId; state: GameState };
  "watch.state": { roomId: RoomId; state: WatchState };
  "matchmaking.status": { ticketId: string; phase: MatchPhase };
  "matchmaking.matched": { ticketId: string; roomCode: string };
  error: { code: string; message: string };
}

export type ServerEventType = keyof ServerEventMap;

export type ServerEvent = {
  [K in ServerEventType]: {
    id: string;
    type: K;
    /** Per-room monotonically increasing sequence, when room-scoped. */
    seq?: number;
    roomId?: RoomId;
    ts: string;
    payload: ServerEventMap[K];
  };
}[ServerEventType];

export type EventOf<K extends ServerEventType> = Extract<ServerEvent, { type: K }>;

const SERVER_EVENT_TYPES = new Set<string>([
  "ack", "room.snapshot", "room.updated", "room.closed", "room.removed", "presence.changed",
  "chat.message", "chat.removed", "reaction", "game.state", "watch.state",
  "matchmaking.status", "matchmaking.matched", "error",
]);

/**
 * Structural guard for inbound frames. Payload shapes are trusted only as far
 * as the server is; this rejects garbage, unknown types and missing ids.
 */
export function parseServerEvent(raw: unknown): ServerEvent | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.type !== "string" || typeof v.ts !== "string") return null;
  if (!SERVER_EVENT_TYPES.has(v.type)) return null;
  if (!v.payload || typeof v.payload !== "object") return null;
  if (v.seq !== undefined && typeof v.seq !== "number") return null;
  return value as ServerEvent;
}
