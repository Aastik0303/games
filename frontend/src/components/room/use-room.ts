"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, describeError, isAbort } from "@/lib/api";
import type { PuzzleAnswer, RoomActivity, RoomPrivacy, WatchSource } from "@/lib/api/types";
import { setActiveRoom } from "@/lib/active-room";
import { getRealtime, RealtimeError, type ClientCommandMap, type ClientCommandType, type Reaction } from "@/lib/realtime";
import { normalizeRoomCode } from "@/lib/room-code";
import { initialRoomState, roomReducer } from "./room-reducer";

/** Strips the roomId from a command payload so call sites don't repeat it. */
type Payload<K extends ClientCommandType> = Omit<ClientCommandMap[K], "roomId">;

export function realtimeErrorMessage(error: unknown): string {
  if (error instanceof RealtimeError) {
    if (error.code === "offline" || error.code === "network") return "You're disconnected — we'll reconnect automatically.";
    if (error.code === "timeout") return "The server didn't respond. Please try again.";
    return error.message;
  }
  return describeError(error);
}

/**
 * Owns one room's lifecycle: REST join → realtime subscribe → snapshot →
 * live events. All mutations are commands the server may reject; the UI only
 * reflects server-confirmed state (chat shows a local "sending" bubble).
 */
export function useRoom(rawCode: string) {
  const code = normalizeRoomCode(rawCode);
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const roomId = state.room?.id ?? null;
  const roomIdRef = useRef<string | null>(null);

  // 1) Join over REST (idempotent for existing members).
  useEffect(() => {
    const controller = new AbortController();
    api.rooms.join(code, { signal: controller.signal }).then(
      (room) => {
        roomIdRef.current = room.id;
        dispatch({ type: "joined", room });
      },
      (error: unknown) => {
        if (!isAbort(error)) dispatch({ type: "join_failed", error });
      },
    );
    api.moderation.blocked({ signal: controller.signal }).then(
      (users) => setBlocked(new Set(users.map((u) => u.id))),
      () => {},
    );
    return () => controller.abort();
  }, [code, attempt]);

  // 2) Subscribe to the room's realtime stream once we know its id.
  useEffect(() => {
    if (!roomId) return;
    const rt = getRealtime();
    rt.connect();
    const off = rt.on((event) => {
      const eventRoom = event.roomId ?? ("roomId" in event.payload ? (event.payload as { roomId?: string }).roomId : undefined);
      if (eventRoom === roomId || (event.type === "room.snapshot" && event.payload.room.id === roomId)) {
        dispatch({ type: "event", event });
      }
    });
    const unsubscribe = rt.subscribeRoom(roomId);
    return () => {
      unsubscribe();
      off();
    };
  }, [roomId]);

  const send = useCallback(
    <K extends ClientCommandType>(type: K, payload: Payload<K>) => {
      const id = roomIdRef.current;
      if (!id) return Promise.reject(new RealtimeError("offline", "Not in a room yet"));
      return getRealtime().send(type, { ...payload, roomId: id } as ClientCommandMap[K]);
    },
    [],
  );

  const leave = useCallback(async () => {
    const id = roomIdRef.current;
    if (id) await api.rooms.leave(id).catch(() => {});
    roomIdRef.current = null;
  }, []);

  // 3) Expose "Leave room" to global UI while this room is on screen.
  useEffect(() => {
    if (state.status !== "ready" || !state.room) return;
    setActiveRoom({ code: state.room.code, leave });
    return () => setActiveRoom(null);
  }, [state.status, state.room?.code, leave, state.room]);

  const sendChat = useCallback(
    async (text: string, existingId?: string) => {
      const clientMsgId = existingId ?? crypto.randomUUID();
      if (existingId) dispatch({ type: "chat_retry", clientMsgId });
      else dispatch({ type: "chat_pending", message: { clientMsgId, text, status: "sending", createdAt: new Date().toISOString() } });
      try {
        // Retries reuse clientMsgId so the server can de-duplicate.
        await send("chat.send", { clientMsgId, text });
      } catch (error) {
        dispatch({ type: "chat_failed", clientMsgId, error: realtimeErrorMessage(error) });
      }
    },
    [send],
  );

  const actions = useMemo(
    () => ({
      setReady: (ready: boolean) => send("room.set_ready", { ready }),
      updateSettings: (patch: { activity?: RoomActivity; capacity?: number; privacy?: RoomPrivacy }) => send("room.update_settings", patch),
      kick: (userId: string) => send("room.kick", { userId }),
      start: () => send("room.start", {}),
      endActivity: () => send("room.end_activity", {}),
      react: (reaction: Reaction) => send("reaction.send", { reaction }),
      submitAnswer: (round: number, answer: PuzzleAnswer) => send("game.submit", { round, answer }),
      setSource: (source: WatchSource) => send("watch.set_source", { source }),
      watchControl: (action: "play" | "pause" | "seek", positionSec: number) => send("watch.control", { action, positionSec }),
      sendChat,
      retryChat: (clientMsgId: string, text: string) => sendChat(text, clientMsgId),
      discardChat: (clientMsgId: string) => dispatch({ type: "chat_discard", clientMsgId }),
      reactionDone: (id: string) => dispatch({ type: "reaction_done", id }),
      block: async (userId: string) => {
        await api.moderation.block(userId);
        setBlocked((prev) => new Set(prev).add(userId));
      },
      leave,
      retryJoin: () => {
        dispatch({ type: "reset" });
        setAttempt((n) => n + 1);
      },
    }),
    [send, sendChat, leave],
  );

  const visibleChat = useMemo(() => state.chat.filter((m) => !blocked.has(m.author.id)), [state.chat, blocked]);

  return { code, state, chat: visibleChat, blocked, actions };
}

export type RoomController = ReturnType<typeof useRoom>;
