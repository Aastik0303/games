import type { ChatMessage, GameState, Room, WatchState } from "@/lib/api/types";
import type { Reaction, ServerEvent } from "@/lib/realtime/events";

export interface PendingMessage {
  clientMsgId: string;
  text: string;
  status: "sending" | "failed";
  error?: string;
  createdAt: string;
}

export interface FloatingReaction {
  id: string;
  userId: string;
  reaction: Reaction;
}

export interface RoomViewState {
  status: "joining" | "ready" | "closed" | "removed" | "error";
  room: Room | null;
  chat: ChatMessage[];
  pending: PendingMessage[];
  game: GameState | null;
  watch: WatchState | null;
  reactions: FloatingReaction[];
  /** True until the first snapshot arrives over the socket. */
  awaitingSnapshot: boolean;
  closedReason?: string;
  error?: unknown;
}

export type RoomAction =
  | { type: "joined"; room: Room }
  | { type: "join_failed"; error: unknown }
  | { type: "event"; event: ServerEvent }
  | { type: "chat_pending"; message: PendingMessage }
  | { type: "chat_failed"; clientMsgId: string; error: string }
  | { type: "chat_retry"; clientMsgId: string }
  | { type: "chat_discard"; clientMsgId: string }
  | { type: "reaction_done"; id: string }
  | { type: "reset" };

export const initialRoomState: RoomViewState = {
  status: "joining",
  room: null,
  chat: [],
  pending: [],
  game: null,
  watch: null,
  reactions: [],
  awaitingSnapshot: true,
};

const MAX_CHAT = 200;

function mergeChat(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).slice(-MAX_CHAT);
}

function dropConfirmedPending(pending: PendingMessage[], chat: ChatMessage[]): PendingMessage[] {
  const confirmed = new Set(chat.map((m) => m.clientMsgId).filter(Boolean));
  return pending.filter((p) => !confirmed.has(p.clientMsgId));
}

/** Pure reducer: every server event is applied idempotently. */
export function roomReducer(state: RoomViewState, action: RoomAction): RoomViewState {
  switch (action.type) {
    case "reset":
      return initialRoomState;
    case "joined":
      return { ...state, status: "ready", room: newerRoom(state.room, action.room), error: undefined };
    case "join_failed":
      return { ...state, status: "error", error: action.error };
    case "chat_pending":
      return { ...state, pending: [...state.pending, action.message] };
    case "chat_failed":
      return { ...state, pending: state.pending.map((p) => (p.clientMsgId === action.clientMsgId ? { ...p, status: "failed", error: action.error } : p)) };
    case "chat_retry":
      return { ...state, pending: state.pending.map((p) => (p.clientMsgId === action.clientMsgId ? { ...p, status: "sending", error: undefined } : p)) };
    case "chat_discard":
      return { ...state, pending: state.pending.filter((p) => p.clientMsgId !== action.clientMsgId) };
    case "reaction_done":
      return { ...state, reactions: state.reactions.filter((r) => r.id !== action.id) };
    case "event":
      return applyEvent(state, action.event);
  }
}

/** Ignore out-of-order room updates using the server's monotonic version. */
function newerRoom(current: Room | null, incoming: Room): Room {
  if (current && current.id === incoming.id && current.version > incoming.version) return current;
  return incoming;
}

function applyEvent(state: RoomViewState, event: ServerEvent): RoomViewState {
  switch (event.type) {
    case "room.snapshot": {
      const chat = mergeChat([], event.payload.chat);
      return {
        ...state,
        status: event.payload.room.phase === "closed" ? "closed" : "ready",
        room: event.payload.room,
        chat,
        pending: dropConfirmedPending(state.pending, chat),
        game: event.payload.game,
        watch: event.payload.watch,
        awaitingSnapshot: false,
      };
    }
    case "room.updated":
      return { ...state, room: newerRoom(state.room, event.payload.room) };
    case "room.closed":
      return { ...state, status: "closed", closedReason: event.payload.reason };
    case "room.removed":
      return { ...state, status: "removed", closedReason: event.payload.reason };
    case "presence.changed": {
      if (!state.room) return state;
      return {
        ...state,
        room: {
          ...state.room,
          participants: state.room.participants.map((p) =>
            p.user.id === event.payload.userId ? { ...p, connection: event.payload.connection } : p,
          ),
        },
      };
    }
    case "chat.message": {
      if (state.chat.some((m) => m.id === event.payload.message.id)) return state;
      const chat = mergeChat(state.chat, [event.payload.message]);
      return { ...state, chat, pending: dropConfirmedPending(state.pending, [event.payload.message]) };
    }
    case "chat.removed":
      return { ...state, chat: state.chat.filter((m) => m.id !== event.payload.messageId) };
    case "reaction":
      return {
        ...state,
        reactions: [...state.reactions.slice(-19), { id: event.id, userId: event.payload.userId, reaction: event.payload.reaction }],
      };
    case "game.state":
      return { ...state, game: event.payload.state };
    case "watch.state":
      return { ...state, watch: event.payload.state };
    default:
      return state;
  }
}
