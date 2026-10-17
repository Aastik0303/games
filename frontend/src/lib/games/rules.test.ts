import { describe, expect, it } from "vitest";
import { matchesAnswer, normalizeAnswer } from "@/lib/api/mock/grading";
import { validateJoinCode } from "@/components/room/join-room-form";
import { formatRoomCode, generateRoomCode, isValidRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET } from "@/lib/room-code";
import { expectedPosition, needsSeek, validateSourceUrl } from "@/components/watch/sync";
import { findConflicts, isSolved } from "./sudoku";

describe("room codes", () => {
  it("normalises case, spaces and dashes", () => {
    expect(normalizeRoomCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(formatRoomCode("abcd2345")).toBe("ABCD-2345");
    expect(isValidRoomCode("abcd-2345")).toBe(true);
  });

  it("rejects look-alike characters with a helpful message", () => {
    expect(validateJoinCode("ABCD-0001")).toMatch(/look-alike/);
    expect(validateJoinCode("ABC")).toMatch(/8 characters/);
    expect(validateJoinCode("")).toMatch(/Enter/);
    expect(validateJoinCode("ABCD2345")).toBeNull();
  });

  it("generates codes only from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(8);
      expect([...code].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });
});

describe("answer grading (mock server)", () => {
  it("ignores case, punctuation, articles and simple plurals", () => {
    expect(normalizeAnswer("  The Piano! ")).toBe("piano");
    expect(matchesAnswer("a PIANO", ["piano"])).toBe(true);
    expect(matchesAnswer("footstep", ["footsteps"])).toBe(true);
    expect(matchesAnswer("guitar", ["piano"])).toBe(false);
    expect(matchesAnswer("   ", ["piano"])).toBe(false);
  });
});

describe("mini sudoku", () => {
  const givens = [[1, null, null, 4], [null, 4, 1, null], [2, null, null, 3], [null, 3, 2, null]];
  it("flags repeats in rows, columns and boxes", () => {
    const grid = [[1, 1, null, 4], [null, 4, 1, null], [2, null, null, 3], [null, 3, 2, null]];
    expect(findConflicts(grid)).toEqual(new Set(["0,0", "0,1"]));
  });
  it("accepts any valid completion that keeps the givens", () => {
    expect(isSolved([[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]], givens)).toBe(true);
    expect(isSolved([[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 1, 2]], givens)).toBe(false);
  });
});

describe("watch sync", () => {
  const base = { source: null, rate: 1, controlPolicy: "host" as const, updatedAt: new Date(10_000).toISOString() };
  it("advances position while playing and holds while paused", () => {
    expect(expectedPosition({ ...base, status: "playing", positionSec: 30 }, 15_000)).toBe(35);
    expect(expectedPosition({ ...base, status: "paused", positionSec: 30 }, 15_000)).toBe(30);
    expect(expectedPosition({ ...base, status: "playing", positionSec: 30 }, 15_000, 32)).toBe(32);
  });
  it("only seeks past the drift threshold", () => {
    expect(needsSeek(10, 10.5)).toBe(false);
    expect(needsSeek(10, 11)).toBe(true);
  });
  it("requires https links", () => {
    expect(validateSourceUrl("http://x.test/a.mp4")).toMatch(/https/);
    expect(validateSourceUrl("nope")).toMatch(/full link/);
    expect(validateSourceUrl("https://x.test/a.mp4")).toBeNull();
  });
});
