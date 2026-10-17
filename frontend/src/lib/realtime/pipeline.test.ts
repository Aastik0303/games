import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAdapter } from "@/lib/api/mock/adapter";
import { MockServer } from "@/lib/api/mock/server";
import type { ProfileInput } from "@/lib/api/types";
import { RealtimeConnection } from "./connection";
import type { ServerEvent } from "./events";

const profile: ProfileInput = {
  displayName: "Host",
  ageBand: "25_34",
  language: "en",
  interests: [],
  accessibility: { captions: false, screenReaderOptimized: false, colorSafePalette: false, extendedTimers: false },
  matching: { preferSharedInterests: false, preferSameLanguage: true, playStyle: "any" },
  consent: { guidelinesAccepted: true, useInterestsForMatching: false },
};

describe("mock pipeline: REST + realtime end to end", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("creates a room, syncs over the socket, starts a game and grades an answer", async () => {
    const server = new MockServer();
    const api = createMockAdapter(server, [0, 0]);
    const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

    const sessionP = api.session.create(profile);
    await tick();
    await sessionP;
    const roomP = api.rooms.create({ activity: { kind: "riddle", gameId: "riddle-relay", difficulty: "easy" }, capacity: 3, privacy: "private" });
    await tick();
    const room = await roomP;

    const rt = new RealtimeConnection(async () => server.connect());
    const events: ServerEvent[] = [];
    rt.on((e) => events.push(e));
    rt.subscribeRoom(room.id);
    rt.connect();
    await tick(300);
    expect(rt.status).toBe("open");
    expect(events.some((e) => e.type === "room.snapshot")).toBe(true);

    server.devAddBot(room.id);
    await tick(3000); // bot joins and readies up
    const lastRoom = [...events].reverse().find((e) => e.type === "room.updated");
    expect(lastRoom?.type === "room.updated" && lastRoom.payload.room.participants.every((p) => p.ready)).toBe(true);

    const startP = rt.send("room.start", { roomId: room.id });
    await tick(100);
    await expect(startP).resolves.toBeUndefined();
    await tick(3100); // countdown → round 1
    const state = [...events].reverse().find((e) => e.type === "game.state");
    expect(state?.type === "game.state" && state.payload.state.phase).toBe("answering");
    if (state?.type !== "game.state") throw new Error("no game state");

    // Riddle Relay is turn-based; the first turn belongs to the host (first participant).
    expect(state.payload.state.turn).toMatchObject({ mode: "turns", activeUserId: server.currentSession()!.user.id });
    expect(JSON.stringify(state.payload.state.puzzle)).not.toMatch(/answers/);

    const wrongP = rt.send("game.submit", { roomId: room.id, round: 1, answer: { kind: "riddle", text: "definitely not it" } });
    await tick(100);
    await expect(wrongP).resolves.toMatchObject({ correct: false, attemptsLeft: 2 });

    // Duplicate frames are suppressed: event ids are unique.
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    rt.close();
  });
});
