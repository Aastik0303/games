"use client";

import { Eye, FileSearch, Gavel, MapPin } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PublicPuzzle, PuzzleAnswer, RevealedClue } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";

type MysteryPuzzle = Extract<PublicPuzzle, { kind: "mystery" }>;

export function MysteryEngine({
  puzzle,
  revealed,
  onInspect,
  onSubmit,
  disabled,
  busy,
}: {
  puzzle: MysteryPuzzle;
  revealed: RevealedClue[];
  onInspect: (clueId: string) => Promise<void>;
  onSubmit: (answer: PuzzleAnswer) => Promise<boolean>;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [suspectId, setSuspectId] = useState("");
  const [method, setMethod] = useState("");
  const [motive, setMotive] = useState("");
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const revealedById = new Map(revealed.map((c) => [c.id, c]));
  const ready = suspectId && method && motive;

  async function accuse(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ready || disabled) return;
    await onSubmit({ kind: "mystery", suspectId, method, motive });
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="case-brief">
        <h2 id="case-brief" className="font-display text-2xl font-semibold tracking-tight">
          {puzzle.title}
        </h2>
        <p className="mt-3 max-w-3xl leading-relaxed text-fg-muted">{puzzle.briefing}</p>
      </section>

      <section aria-labelledby="suspects-title">
        <h3 id="suspects-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-subtle">
          Suspects
        </h3>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {puzzle.suspects.map((s) => (
            <li key={s.id} className="rounded-2xl border border-line bg-white/[0.02] p-4">
              <p className="font-semibold">{s.name}</p>
              <p className="text-xs text-fg-subtle">{s.role}</p>
              <blockquote className="mt-2 border-l-2 border-violet-400/40 pl-3 text-sm italic text-fg-muted">“{s.statement}”</blockquote>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="clues-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="clues-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-subtle">
            Evidence
          </h3>
          <p className="text-xs text-fg-subtle">
            {revealed.length}/{puzzle.clues.length} inspected · inspecting more than 5 costs points
          </p>
        </div>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {puzzle.clues.map((clue) => {
            const open = revealedById.get(clue.id);
            return (
              <li key={clue.id} className={cn("rounded-2xl border p-4 transition-colors", open ? "border-cyan-400/25 bg-cyan-400/[0.04]" : "border-line")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{clue.title}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle">
                      <MapPin className="size-3" aria-hidden="true" /> {clue.location}
                    </p>
                  </div>
                  {!open && (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Eye className="size-4" />}
                      loading={inspecting === clue.id}
                      disabled={disabled}
                      onClick={async () => {
                        setInspecting(clue.id);
                        try {
                          await onInspect(clue.id);
                        } finally {
                          setInspecting(null);
                        }
                      }}
                    >
                      Inspect<span className="sr-only"> {clue.title}</span>
                    </Button>
                  )}
                </div>
                {open && (
                  <p className="mt-3 flex gap-2 text-sm leading-relaxed text-fg">
                    <FileSearch className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden="true" />
                    {open.detail}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <form onSubmit={accuse} className="rounded-2xl border border-violet-400/25 bg-violet-400/[0.04] p-5" aria-labelledby="accuse-title">
        <div className="flex items-center gap-2">
          <Gavel className="size-5 text-violet-300" aria-hidden="true" />
          <h3 id="accuse-title" className="font-display text-lg font-semibold">
            Make your accusation
          </h3>
          <Badge tone="warning" className="ml-auto">One attempt</Badge>
        </div>
        <fieldset className="mt-4" disabled={disabled}>
          <legend className="text-sm font-medium">Who did it?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {puzzle.suspects.map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cyan-300",
                  suspectId === s.id ? "border-violet-400/60 bg-violet-400/10" : "border-line hover:border-line-strong",
                )}
              >
                <input type="radio" name="suspect" value={s.id} checked={suspectId === s.id} onChange={() => setSuspectId(s.id)} className="accent-violet-400" />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="How?" error={tried && !method ? "Choose a method." : null}>
            {(p) => (
              <Select {...p} value={method} onChange={(e) => setMethod(e.target.value)} disabled={disabled}>
                <option value="">Choose…</option>
                {puzzle.methods.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Why?" error={tried && !motive ? "Choose a motive." : null}>
            {(p) => (
              <Select {...p} value={motive} onChange={(e) => setMotive(e.target.value)} disabled={disabled}>
                <option value="">Choose…</option>
                {puzzle.motives.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {tried && !suspectId && <p className="mt-2 text-xs font-medium text-danger" role="alert">Choose a suspect.</p>}
        <div className="mt-5 flex justify-end">
          <Button type="submit" variant="primary" loading={busy} disabled={disabled}>
            Accuse
          </Button>
        </div>
      </form>
    </div>
  );
}
