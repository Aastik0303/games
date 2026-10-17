import type { GameSummary, Room } from "@/lib/api/types";

/**
 * Why the host can't start yet. Mirrors server rules for clear UI copy; the
 * server still has the final say when `room.start` is sent.
 */
export function startBlockers(room: Room, game: GameSummary | null): string[] {
  const blockers: string[] = [];
  if (room.phase !== "lobby") return ["An activity is already running."];
  if (room.activity.kind === "watch") {
    if (room.participants.length < 1) blockers.push("Nobody is here yet.");
    return blockers;
  }
  if (!game) return ["Choose a game."];
  if (room.participants.length < game.minPlayers) {
    const missing = game.minPlayers - room.participants.length;
    blockers.push(`Waiting for ${missing} more ${missing === 1 ? "player" : "players"}.`);
  }
  const notReady = room.participants.filter((p) => p.role !== "host" && !p.ready);
  if (notReady.length > 0) {
    blockers.push(
      notReady.length === 1 ? `${notReady[0].user.displayName} isn't ready.` : `${notReady.length} players aren't ready.`,
    );
  }
  const offline = room.participants.filter((p) => p.connection !== "online");
  if (offline.length > 0) blockers.push(`${offline.length === 1 ? offline[0].user.displayName + " is" : offline.length + " players are"} reconnecting.`);
  return blockers;
}

/** Capacity choices the host may pick for the current activity. */
export function capacityOptions(room: Room, game: GameSummary | null): number[] {
  const [min, max] = room.activity.kind === "watch" ? [2, 8] : game ? [Math.max(2, game.minPlayers), game.maxPlayers] : [2, 4];
  const floor = Math.max(min, room.participants.length);
  return Array.from({ length: Math.max(0, max - floor + 1) }, (_, i) => floor + i);
}
