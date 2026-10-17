"use client";

import { useState, type FormEvent } from "react";
import type { PublicPuzzle, PuzzleAnswer } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

type TextPuzzle = Extract<PublicPuzzle, { kind: "word" | "riddle" }>;

/** Renders the sentence with its gap as a visible, labelled blank. */
function Template({ template, letters }: { template: string; letters: number }) {
  const [before, after = ""] = template.split("___");
  return (
    <p className="font-display text-2xl font-medium leading-snug tracking-tight text-balance sm:text-3xl">
      {before}
      <span className="mx-1 inline-flex translate-y-1 gap-1 align-baseline" aria-label={`blank, ${letters} letters`} role="img">
        {Array.from({ length: letters }, (_, i) => (
          <span key={i} className="inline-block h-1 w-4 rounded-full bg-violet-300/80 sm:w-5" />
        ))}
      </span>
      {after}
    </p>
  );
}

export function TextAnswerEngine({
  puzzle,
  onSubmit,
  disabled,
  busy,
  disabledReason,
}: {
  puzzle: TextPuzzle;
  onSubmit: (answer: PuzzleAnswer) => Promise<boolean>;
  disabled?: boolean;
  busy?: boolean;
  disabledReason?: string;
}) {
  const [text, setText] = useState("");
  const inputId = `answer-${puzzle.id}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || disabled || busy) return;
    const accepted = await onSubmit({ kind: puzzle.kind, text: text.trim() });
    // Clear only on a definitive result so a network error doesn't lose input.
    if (accepted) setText("");
  }

  return (
    <div className="flex flex-col gap-6">
      {puzzle.kind === "word" ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-subtle">{puzzle.prompt}</p>
          <div className="mt-3">
            <Template template={puzzle.template} letters={puzzle.letters} />
          </div>
        </div>
      ) : (
        <p className="font-display text-2xl font-medium leading-snug tracking-tight text-balance sm:text-3xl">{puzzle.text}</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={inputId} className="sr-only">
          Your answer
        </label>
        <Input
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? (disabledReason ?? "Answers closed") : "Type your answer"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={60}
          disabled={disabled}
          className="h-12 text-base"
        />
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={disabled || !text.trim()}>
          Submit
        </Button>
      </form>
    </div>
  );
}
