"use client";

import { Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { getRealtime } from "@/lib/realtime";

/** Seconds remaining until a server timestamp, corrected for clock offset. */
export function useServerCountdown(endsAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(getRealtime().serverNow()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000));
}

export function SharedTimer({ endsAt, label = "Time left" }: { endsAt: string | null; label?: string }) {
  const seconds = useServerCountdown(endsAt);
  if (seconds === null) return null;
  const urgent = seconds <= 5;
  const announce = seconds === 10 || seconds === 5;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 font-display text-lg font-semibold tabular-nums",
        urgent ? "border-danger/40 bg-danger/10 text-danger" : "border-line-strong bg-white/[0.04] text-fg",
      )}
    >
      <Timer className="size-4" aria-hidden="true" />
      <span role="timer" aria-label={`${label}: ${seconds} seconds`}>
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <span className="sr-only" aria-live="assertive">
        {announce ? `${seconds} seconds left` : ""}
      </span>
    </div>
  );
}
