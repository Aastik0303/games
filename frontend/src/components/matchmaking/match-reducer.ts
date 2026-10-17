import type { MatchPhase } from "@/lib/api/types";

export type MatchState =
  | { step: "configure"; notice?: string }
  | { step: "enqueuing" }
  | { step: "searching"; ticketId: string; phase: MatchPhase; startedAt: number }
  | { step: "matched"; ticketId: string; roomCode: string }
  | { step: "cancelling"; ticketId: string };

export type MatchAction =
  | { type: "enqueue" }
  | { type: "enqueued"; ticketId: string; at: number }
  | { type: "enqueue_failed"; message: string }
  | { type: "status"; ticketId: string; phase: MatchPhase }
  | { type: "matched"; ticketId: string; roomCode: string }
  | { type: "cancel" }
  | { type: "cancelled" }
  | { type: "reset" };

/** Events for stale tickets are ignored so a late "matched" can't hijack a new search. */
export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case "enqueue":
      return state.step === "configure" ? { step: "enqueuing" } : state;
    case "enqueued":
      return state.step === "enqueuing" ? { step: "searching", ticketId: action.ticketId, phase: "queued", startedAt: action.at } : state;
    case "enqueue_failed":
      return { step: "configure", notice: action.message };
    case "status":
      if (state.step !== "searching" || state.ticketId !== action.ticketId) return state;
      if (action.phase === "expired") return { step: "configure", notice: "We couldn't find a group this time. Try a different size or difficulty, or try again shortly." };
      if (action.phase === "cancelled") return { step: "configure" };
      return { ...state, phase: action.phase };
    case "matched":
      if (state.step !== "searching" || state.ticketId !== action.ticketId) return state;
      return { step: "matched", ticketId: action.ticketId, roomCode: action.roomCode };
    case "cancel":
      return state.step === "searching" ? { step: "cancelling", ticketId: state.ticketId } : state;
    case "cancelled":
    case "reset":
      return { step: "configure" };
  }
}

export const PHASE_COPY: Record<MatchPhase, string> = {
  queued: "You're in the queue",
  searching: "Looking for players who picked the same activity",
  widening: "Widening the search a little — still looking for a good group",
  matched: "Match found!",
  expired: "Search ended",
  cancelled: "Search cancelled",
};
