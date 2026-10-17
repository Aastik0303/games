"use client";

import { useEffect } from "react";
import { REACTIONS, type Reaction } from "@/lib/realtime/events";
import type { FloatingReaction } from "./room-reducer";

const LABELS: Record<Reaction, string> = {
  "👏": "Applause",
  "🔥": "Fire",
  "😂": "Laughing",
  "🤯": "Mind blown",
  "💜": "Heart",
  "🎉": "Celebrate",
};

export function ReactionBar({ onReact, disabled }: { onReact: (r: Reaction) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Send a reaction" className="flex items-center gap-1">
      {REACTIONS.map((r) => (
        <button
          key={r}
          type="button"
          disabled={disabled}
          onClick={() => onReact(r)}
          aria-label={LABELS[r]}
          title={LABELS[r]}
          className="flex size-9 items-center justify-center rounded-xl text-lg transition-transform hover:scale-110 hover:bg-white/8 disabled:opacity-40 disabled:hover:scale-100"
        >
          <span aria-hidden="true">{r}</span>
        </button>
      ))}
    </div>
  );
}

/** Decorative floating reactions; announced once via a polite live region. */
export function ReactionOverlay({
  reactions,
  nameFor,
  onDone,
}: {
  reactions: FloatingReaction[];
  nameFor: (userId: string) => string;
  onDone: (id: string) => void;
}) {
  const latest = reactions.at(-1);
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 h-40 overflow-hidden" aria-hidden="true">
        {reactions.map((r) => (
          <Floater key={r.id} reaction={r} onDone={onDone} />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {latest ? `${nameFor(latest.userId)} reacted ${LABELS[latest.reaction]}` : ""}
      </p>
    </>
  );
}

function Floater({ reaction, onDone }: { reaction: FloatingReaction; onDone: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDone(reaction.id), 1900);
    return () => clearTimeout(t);
  }, [reaction.id, onDone]);
  // Deterministic horizontal position derived from the event id.
  const left = 10 + (parseInt(reaction.id.replace(/\D/g, "").slice(-3) || "0", 10) % 80);
  return (
    <span className="absolute bottom-0 animate-float-up text-3xl" style={{ left: `${left}%` }}>
      {reaction.reaction}
    </span>
  );
}
