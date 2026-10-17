import type { WatchState } from "@/lib/api/types";

/** Drift beyond this (seconds) triggers a hard seek; smaller drift is tolerated. */
export const SEEK_THRESHOLD_SEC = 0.75;

/** Where playback should be right now according to the server's last state. */
export function expectedPosition(state: WatchState, serverNowMs: number, durationSec?: number): number {
  let pos = state.positionSec;
  if (state.status === "playing") {
    const elapsed = Math.max(0, (serverNowMs - Date.parse(state.updatedAt)) / 1000);
    pos += elapsed * state.rate;
  }
  if (durationSec !== undefined && Number.isFinite(durationSec)) pos = Math.min(pos, durationSec);
  return Math.max(0, pos);
}

export function needsSeek(currentSec: number, expectedSec: number, threshold = SEEK_THRESHOLD_SEC): boolean {
  return Math.abs(currentSec - expectedSec) > threshold;
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Light client-side check; the server performs the authoritative validation and allow-listing. */
export function validateSourceUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Enter a full link starting with https://";
  }
  if (url.protocol !== "https:") return "Only secure https:// links can be shared.";
  return null;
}
