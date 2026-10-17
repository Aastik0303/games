"use client";

import type { PublicPuzzle, PuzzleAnswer, RevealedClue } from "@/lib/api/types";
import { LogicGridEngine } from "./logic-grid";
import { MysteryEngine } from "./mystery-case";
import { TextAnswerEngine } from "./text-answer";

/**
 * Engine registry: maps a server puzzle payload to its UI. Each engine only
 * collects an answer — grading and scoring always come back from the server.
 */
export function PuzzleView({
  puzzle,
  onSubmit,
  disabled,
  busy,
  disabledReason,
  revealedClues = [],
  onInspect,
}: {
  puzzle: PublicPuzzle;
  onSubmit: (answer: PuzzleAnswer) => Promise<boolean>;
  disabled?: boolean;
  busy?: boolean;
  disabledReason?: string;
  revealedClues?: RevealedClue[];
  onInspect?: (clueId: string) => Promise<void>;
}) {
  switch (puzzle.kind) {
    case "word":
    case "riddle":
      return <TextAnswerEngine puzzle={puzzle} onSubmit={onSubmit} disabled={disabled} busy={busy} disabledReason={disabledReason} />;
    case "logic":
      return <LogicGridEngine puzzle={puzzle} onSubmit={onSubmit} disabled={disabled} busy={busy} />;
    case "mystery":
      return (
        <MysteryEngine
          puzzle={puzzle}
          revealed={revealedClues}
          onInspect={onInspect ?? (async () => {})}
          onSubmit={onSubmit}
          disabled={disabled}
          busy={busy}
        />
      );
  }
}
