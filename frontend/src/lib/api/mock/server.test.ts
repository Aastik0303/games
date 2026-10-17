import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileInput } from "../types";
import { MockServer } from "./server";

const profile: ProfileInput = {
  displayName: "Tester",
  ageBand: "18_24",
  language: "en",
  interests: [],
  accessibility: { captions: false, screenReaderOptimized: false, colorSafePalette: false, extendedTimers: false },
  matching: { preferSharedInterests: false, preferSameLanguage: true, playStyle: "any" },
  consent: { guidelinesAccepted: true, useInterestsForMatching: false },
};

describe("MockServer (server-authoritative rules)", () => {
  let server: MockServer;
  beforeEach(() => {
    sessionStorage.clear();
    server = new MockServer();
  });

  it("never sends solutions with a puzzle", () => {
    server.createSession(profile);
    for (const id of ["missing-word", "riddle-relay", "mini-grid", "wrenfield-manor"]) {
      const game = server.getGame(id);
      const s = server.startSolo(id, game.difficulties[0]);
      expect(JSON.stringify(s.puzzle)).not.toMatch(/"answers"|"solution"|"detail"/);
    }
  });

  it("grades on the server and closes after the last attempt", () => {
    server.createSession(profile);
    const s = server.startSolo("riddle-relay", "easy");
    const r1 = server.submitSolo(s.id, { kind: "riddle", text: "definitely wrong" });
    expect(r1).toMatchObject({ correct: false, attemptsLeft: 2, closed: false });
    expect(r1.solution).toBeUndefined();
    server.submitSolo(s.id, { kind: "riddle", text: "nope" });
    const r3 = server.submitSolo(s.id, { kind: "riddle", text: "still no" });
    expect(r3.closed).toBe(true);
    expect(r3.solution).toBeTruthy();
    expect(() => server.submitSolo(s.id, { kind: "riddle", text: "late" })).toThrow(/closed/);
  });

  it("applies minor safety defaults that can't be loosened", () => {
    server.createSession({ ...profile, ageBand: "13_15" });
    expect(server.getPrivacy()).toMatchObject({ chatFilter: "strict", invitePolicy: "matched_only" });
    expect(server.setPrivacy({ showOnlineStatus: true, invitePolicy: "matched_only", chatFilter: "standard" }).chatFilter).toBe("strict");
  });

  it("rejects admin calls without the admin role", () => {
    server.createSession(profile);
    expect(() => server.adminOverview()).toThrow(/Admin access/);
  });

  it("rejects host-only commands from non-hosts and validates chat", async () => {
    vi.useFakeTimers();
    server.createSession(profile);
    const room = server.createRoom({ activity: { kind: "word", gameId: "missing-word", difficulty: "easy" }, capacity: 4, privacy: "private" });
    // Make the user a non-host by handing hosting to someone else.
    room.hostId = "someone-else";
    const socket = server.connect();
    const frames: { type: string; payload: { ok?: boolean; error?: { code: string } } }[] = [];
    socket.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
    await vi.advanceTimersByTimeAsync(200);
    socket.send(JSON.stringify({ id: "c1", type: "room.start", payload: { roomId: room.id } }));
    socket.send(JSON.stringify({ id: "c2", type: "chat.send", payload: { roomId: room.id, clientMsgId: "m", text: "x".repeat(301) } }));
    await vi.advanceTimersByTimeAsync(200);
    const acks = frames.filter((f) => f.type === "ack");
    expect(acks.map((a) => a.payload.error?.code)).toEqual(["forbidden", "validation"]);
    vi.useRealTimers();
  });
});
