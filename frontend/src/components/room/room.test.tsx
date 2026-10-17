import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, GameSummary, Participant, Room } from "@/lib/api/types";
import type { ServerEvent } from "@/lib/realtime/events";
import { ToastProvider } from "@/components/ui/toast";
import { matchReducer } from "@/components/matchmaking/match-reducer";
import { Lobby } from "./lobby";
import { capacityOptions, startBlockers } from "./lobby-rules";
import { initialRoomState, roomReducer } from "./room-reducer";
import type { RoomController } from "./use-room";

const user = (id: string, name: string) => ({ id, displayName: name, avatarHue: 200 });
const participant = (id: string, name: string, role: Participant["role"], ready: boolean): Participant => ({
  user: user(id, name), role, ready, connection: "online", joinedAt: "2026-01-01T00:00:00Z",
});
const game: GameSummary = {
  id: "missing-word", kind: "word", title: "Missing Word", tagline: "t", category: "Word", difficulties: ["easy", "medium"],
  modes: ["solo", "multiplayer"], turnMode: "simultaneous", minPlayers: 2, maxPlayers: 8, estMinutes: 5, enabled: true,
};
const room = (participants: Participant[], extra: Partial<Room> = {}): Room => ({
  id: "room-1", code: "ABCD2345", hostId: "host", activity: { kind: "word", gameId: "missing-word", difficulty: "easy" },
  capacity: 4, privacy: "private", phase: "lobby", participants, createdAt: "2026-01-01T00:00:00Z", version: 3, ...extra,
});
const ev = (e: Omit<ServerEvent, "ts">) => ({ ts: "2026-01-01T00:00:00Z", ...e }) as ServerEvent;

describe("lobby rules", () => {
  it("lists who's blocking the start", () => {
    expect(startBlockers(room([participant("host", "Host", "host", true)]), game)).toEqual(["Waiting for 1 more player."]);
    expect(startBlockers(room([participant("host", "Host", "host", true), participant("p", "Nova", "player", false)]), game)).toEqual(["Nova isn't ready."]);
    expect(startBlockers(room([participant("host", "Host", "host", true), participant("p", "Nova", "player", true)]), game)).toEqual([]);
  });
  it("never offers fewer seats than people present", () => {
    const r = room([participant("host", "H", "host", true), participant("a", "A", "player", true), participant("b", "B", "player", true)]);
    expect(capacityOptions(r, game)[0]).toBe(3);
  });
});

describe("room reducer", () => {
  const msg = (id: string, clientMsgId?: string): ChatMessage => ({ id, clientMsgId, roomId: "room-1", author: user("host", "Host"), text: "hi", sentAt: `2026-01-01T00:00:0${id.slice(-1)}Z`, kind: "user" });

  it("ignores out-of-order room versions", () => {
    let s = roomReducer(initialRoomState, { type: "joined", room: room([], { version: 5 }) });
    s = roomReducer(s, { type: "event", event: ev({ id: "e1", type: "room.updated", payload: { room: room([], { version: 4, capacity: 2 }) } }) });
    expect(s.room?.capacity).toBe(4);
  });

  it("replaces a pending chat bubble when the server confirms it, without duplicates", () => {
    let s = roomReducer(initialRoomState, { type: "chat_pending", message: { clientMsgId: "c1", text: "hi", status: "sending", createdAt: "" } });
    const confirmed = ev({ id: "e2", type: "chat.message", payload: { message: msg("m1", "c1") } });
    s = roomReducer(s, { type: "event", event: confirmed });
    s = roomReducer(s, { type: "event", event: { ...confirmed, id: "e3" } });
    expect(s.pending).toHaveLength(0);
    expect(s.chat.map((m) => m.id)).toEqual(["m1"]);
  });

  it("applies a snapshot as authoritative state", () => {
    const s = roomReducer(initialRoomState, {
      type: "event",
      event: ev({ id: "e4", type: "room.snapshot", payload: { room: room([]), chat: [msg("m2"), msg("m1")], game: null, watch: null } }),
    });
    expect(s.awaitingSnapshot).toBe(false);
    expect(s.chat.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("moves to closed when the host closes the room", () => {
    const s = roomReducer(initialRoomState, { type: "event", event: ev({ id: "e5", type: "room.closed", payload: { roomId: "room-1", reason: "host_left" } }) });
    expect(s.status).toBe("closed");
  });
});

describe("matchmaking reducer", () => {
  it("ignores events for an old ticket", () => {
    let s = matchReducer({ step: "configure" }, { type: "enqueue" });
    s = matchReducer(s, { type: "enqueued", ticketId: "t2", at: 0 });
    s = matchReducer(s, { type: "matched", ticketId: "t1", roomCode: "OLDROOM1" });
    expect(s).toMatchObject({ step: "searching", ticketId: "t2" });
    s = matchReducer(s, { type: "status", ticketId: "t2", phase: "widening" });
    expect(s).toMatchObject({ phase: "widening" });
    s = matchReducer(s, { type: "matched", ticketId: "t2", roomCode: "ABCD2345" });
    expect(s).toEqual({ step: "matched", ticketId: "t2", roomCode: "ABCD2345" });
  });
});

function renderLobby(selfId: string, participants: Participant[]) {
  const actions = { setReady: vi.fn(async () => undefined), start: vi.fn(async () => undefined), updateSettings: vi.fn(async () => undefined) } as unknown as RoomController["actions"];
  render(
    <ToastProvider>
      <Lobby room={room(participants)} selfId={selfId} games={[game]} actions={actions} connected />
    </ToastProvider>,
  );
  return actions;
}

describe("<Lobby />", () => {
  const everyone = [participant("host", "Host", "host", true), participant("p", "Nova", "player", false)];

  it("gives the host a start button that waits for ready players", () => {
    renderLobby("host", everyone);
    expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
    expect(screen.getByText("Nova isn't ready.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Host controls" })).toBeInTheDocument();
  });

  it("gives players a ready toggle and no host controls", async () => {
    const actions = renderLobby("p", everyone);
    expect(screen.queryByRole("button", { name: "Start game" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Host controls" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I'm ready" }));
    expect(actions.setReady).toHaveBeenCalledWith(true);
  });

  it("shows the invite code formatted for reading aloud", () => {
    renderLobby("p", everyone);
    expect(screen.getByText("ABCD-2345")).toBeInTheDocument();
  });
});
