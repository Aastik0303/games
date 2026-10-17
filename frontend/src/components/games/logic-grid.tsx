"use client";

import { AlertCircle } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PublicPuzzle, PuzzleAnswer } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { emptyGrid, findConflicts, isComplete, type Grid } from "@/lib/games/sudoku";
import { Button } from "@/components/ui/button";

type LogicPuzzle = Extract<PublicPuzzle, { kind: "logic" }>;

export function LogicGridEngine({
  puzzle,
  onSubmit,
  disabled,
  busy,
}: {
  puzzle: LogicPuzzle;
  onSubmit: (answer: PuzzleAnswer) => Promise<boolean>;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [grid, setGrid] = useState<Grid>(() => emptyGrid(puzzle.givens));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const conflicts = useMemo(() => findConflicts(grid), [grid]);
  const complete = isComplete(grid);
  const size = puzzle.size;

  const setCell = (r: number, c: number, v: number | null) =>
    setGrid((g) => g.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row)));

  const focusCell = (r: number, c: number) => refs.current[((r + size) % size) * size + ((c + size) % size)]?.focus();

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      focusCell(r + move[0], c + move[1]);
    } else if ((e.key === "Backspace" || e.key === "Delete") && puzzle.givens[r][c] == null) {
      e.preventDefault();
      setCell(r, c, null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <p className="max-w-md text-center text-sm text-fg-muted">{puzzle.rules}</p>
      <div
        role="grid"
        aria-label="Number grid, 4 by 4. Use arrow keys to move and type 1 to 4."
        className="grid grid-cols-4 overflow-hidden rounded-2xl border border-line-strong bg-ink-850/80"
      >
        {grid.map((row, r) => (
          <div role="row" key={r} className="contents">
            {row.map((value, c) => {
              const given = puzzle.givens[r][c] != null;
              const conflict = conflicts.has(`${r},${c}`);
              return (
                <div
                  role="gridcell"
                  key={c}
                  className={cn(
                    "relative border-line",
                    c % 2 === 1 && c < size - 1 && "border-r-2 border-r-white/25",
                    c % 2 === 0 && "border-r",
                    r % 2 === 1 && r < size - 1 && "border-b-2 border-b-white/25",
                    r % 2 === 0 && "border-b",
                  )}
                >
                  <input
                    ref={(el) => {
                      refs.current[r * size + c] = el;
                    }}
                    inputMode="numeric"
                    aria-label={`Row ${r + 1}, column ${c + 1}${given ? ", given" : ""}${conflict ? ", conflicts with another cell" : ""}`}
                    aria-invalid={conflict || undefined}
                    readOnly={given || disabled}
                    value={value ?? ""}
                    onKeyDown={(e) => onKeyDown(e, r, c)}
                    onChange={(e) => {
                      if (given) return;
                      const digit = e.target.value.replace(/\D/g, "").slice(-1);
                      const n = Number(digit);
                      setCell(r, c, digit && n >= 1 && n <= size ? n : null);
                    }}
                    className={cn(
                      "size-16 bg-transparent text-center font-display text-2xl tabular-nums outline-none transition-colors sm:size-20 sm:text-3xl",
                      "focus-visible:bg-cyan-400/10 focus-visible:outline-2 focus-visible:-outline-offset-2",
                      given ? "font-semibold text-fg" : "text-cyan-300",
                      conflict && "bg-danger/15 text-danger underline decoration-wavy decoration-2 underline-offset-4",
                    )}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="min-h-5 text-sm text-fg-muted" aria-live="polite">
        {conflicts.size > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-danger">
            <AlertCircle className="size-4" aria-hidden="true" /> Some numbers repeat (shown with a wavy underline).
          </span>
        ) : complete ? (
          "Grid filled — submit when you're ready."
        ) : (
          `${grid.flat().filter((v) => v == null).length} cells left`
        )}
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={disabled} onClick={() => setGrid(emptyGrid(puzzle.givens))}>
          Clear
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={disabled || !complete}
          onClick={() => void onSubmit({ kind: "logic", grid: grid.map((row) => row.map((v) => v ?? 0)) })}
        >
          Check solution
        </Button>
      </div>
    </div>
  );
}
