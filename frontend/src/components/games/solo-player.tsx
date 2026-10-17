"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Lightbulb, RotateCcw, SkipForward, Trophy, XCircle } from "lucide-react";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { AnswerResult, Difficulty, GameSummary, PuzzleAnswer, SoloSession } from "@/lib/api/types";
import { playCue } from "@/lib/cues";
import { useDeviceSettings } from "@/lib/settings";
import { useApiQuery } from "@/lib/use-api-query";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Segmented } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api/errors";
import { DIFFICULTY_LABEL, KIND_META } from "./meta";
import { PuzzleView } from "./puzzle-view";

export function SoloPlayer({ gameId }: { gameId: string }) {
  const game = useApiQuery(`game:${gameId}`, (signal) => api.catalog.get(gameId, { signal }));

  if (game.error) {
    const notFound = isApiError(game.error) && game.error.code === "not_found";
    return notFound ? (
      <EmptyState title="Game not found" actions={<ButtonLink href="/solo">Back to library</ButtonLink>}>
        This game doesn&apos;t exist or is temporarily unavailable.
      </EmptyState>
    ) : (
      <ErrorState actions={<Button onClick={game.reload}>Retry</Button>}>{describeError(game.error)}</ErrorState>
    );
  }
  if (!game.data) {
    return (
      <LoadingBlock label="Loading game">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="mt-6 h-96" />
      </LoadingBlock>
    );
  }
  return <SoloGame game={game.data} />;
}

function SoloGame({ game }: { game: GameSummary }) {
  const toast = useToast();
  const settings = useDeviceSettings();
  const [difficulty, setDifficulty] = useState<Difficulty>(game.difficulties[0]);
  const [session, setSession] = useState<SoloSession | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [busy, setBusy] = useState<"start" | "submit" | "hint" | "next" | null>(null);
  const meta = KIND_META[game.kind];
  const Icon = meta.icon;

  async function run<T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(kind);
    try {
      return await fn();
    } catch (e) {
      toast.error("That didn't work", describeError(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const start = () =>
    run("start", async () => {
      const s = await api.solo.start(game.id, difficulty);
      setSession(s);
      setResult(null);
      setHints([]);
    });

  const submit = async (answer: PuzzleAnswer): Promise<boolean> => {
    if (!session) return false;
    const r = await run("submit", () => api.solo.submit(session.id, answer));
    if (!r) return false;
    setResult(r);
    setSession((s) => (s ? { ...s, score: r.totalScore } : s));
    if (r.correct) playCue("correct", settings);
    return true;
  };

  const next = () =>
    run("next", async () => {
      if (!session) return;
      const s = await api.solo.advance(session.id);
      setSession(s);
      setResult(null);
      setHints([]);
    });

  const hint = () =>
    run("hint", async () => {
      if (!session) return;
      const h = await api.solo.hint(session.id);
      setHints((list) => [...list, h.hint]);
      setSession((s) => (s ? { ...s, hintsLeft: h.hintsLeft } : s));
    });

  const inspect = async (clueId: string) => {
    if (!session) return;
    await run("hint", async () => {
      const clue = await api.solo.inspectClue(session.id, clueId);
      setSession((s) => (s ? { ...s, revealedClues: [...s.revealedClues.filter((c) => c.id !== clue.id), clue] } : s));
    });
  };

  const header = (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <ButtonLink href="/solo" variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />}>
        Library
      </ButtonLink>
      <span className={`flex size-9 items-center justify-center rounded-xl border border-line-strong ${meta.accent}`} aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{game.title}</h1>
    </div>
  );

  if (!session) {
    return (
      <>
        {header}
        <Panel featured className="mx-auto max-w-xl p-6 sm:p-8">
          <p className="text-fg-muted">{game.tagline}</p>
          {game.difficulties.length > 1 && (
            <div className="mt-6">
              <Segmented
                legend="Difficulty"
                name="solo-difficulty"
                value={difficulty}
                onChange={setDifficulty}
                options={game.difficulties.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))}
              />
            </div>
          )}
          <Button className="mt-6 w-full" variant="primary" size="lg" loading={busy === "start"} onClick={() => void start()}>
            Start
          </Button>
        </Panel>
      </>
    );
  }

  if (session.status === "complete") {
    return (
      <>
        {header}
        <Panel featured className="mx-auto flex max-w-xl flex-col items-center p-8 text-center">
          <Trophy className="size-10 text-warning" aria-hidden="true" />
          <h2 className="mt-4 font-display text-2xl font-semibold">Session complete</h2>
          <p className="mt-2 text-fg-muted">
            Final score <span className="font-display text-3xl font-semibold text-fg tabular-nums">{session.score}</span>
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => setSession(null)}>
              Play again
            </Button>
            <ButtonLink href="/solo">More games</ButtonLink>
            {game.modes.includes("multiplayer") && <ButtonLink href={`/play?game=${game.id}`}>Play with others</ButtonLink>}
          </div>
        </Panel>
      </>
    );
  }

  const closed = result?.closed ?? false;
  const isLast = session.index + 1 >= session.total;

  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Panel className="min-w-0 p-5 sm:p-8">
          <PuzzleView
            key={session.puzzle.id}
            puzzle={session.puzzle}
            revealedClues={session.revealedClues}
            onInspect={inspect}
            onSubmit={submit}
            disabled={closed}
            busy={busy === "submit"}
          />
          <div aria-live="polite" className="mt-6 empty:hidden">
            {result && (
              <div
                className={`flex items-start gap-3 rounded-2xl border p-4 ${result.correct ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10"}`}
              >
                {result.correct ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
                )}
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">
                    {result.correct ? "Correct" : "Incorrect"} · {result.feedback}
                    {result.scoreDelta > 0 && <span className="ml-2 text-success">+{result.scoreDelta}</span>}
                  </p>
                  {!result.closed && <p className="mt-1 text-fg-muted">{result.attemptsLeft} {result.attemptsLeft === 1 ? "attempt" : "attempts"} left.</p>}
                  {result.closed && result.solution && (
                    <p className="mt-1 text-fg-muted">
                      {game.kind === "mystery" ? result.solution : <>Answer: <span className="font-medium text-fg">{result.solution}</span></>}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Panel>

        <aside className="flex flex-col gap-4" aria-label="Session">
          <Panel className="p-5">
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-fg-subtle">Puzzle</dt>
                <dd className="font-display text-xl font-semibold tabular-nums">
                  {session.index + 1}/{session.total}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-subtle">Score</dt>
                <dd className="font-display text-xl font-semibold tabular-nums">{session.score}</dd>
              </div>
            </dl>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={session.total} aria-valuenow={session.index + (closed ? 1 : 0)}>
              <div className="prism-bar h-full rounded-full transition-[width] duration-500" style={{ width: `${((session.index + (closed ? 1 : 0)) / session.total) * 100}%` }} />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Badge tone="violet">{DIFFICULTY_LABEL[session.difficulty]}</Badge>
              <Badge>{session.hintsLeft} hints left</Badge>
            </div>
          </Panel>

          <Panel className="flex flex-col gap-2 p-5">
            {closed ? (
              <Button variant="primary" loading={busy === "next"} icon={<ArrowRight className="size-4" />} onClick={() => void next()}>
                {isLast ? "Finish" : "Next puzzle"}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  icon={<Lightbulb className="size-4" />}
                  loading={busy === "hint"}
                  disabled={session.hintsLeft <= 0 || busy !== null}
                  onClick={() => void hint()}
                >
                  Hint
                </Button>
                <Button variant="ghost" icon={<SkipForward className="size-4" />} loading={busy === "next"} disabled={busy !== null} onClick={() => void next()}>
                  {isLast ? "Give up & finish" : "Skip (no points)"}
                </Button>
              </>
            )}
          </Panel>

          {hints.length > 0 && (
            <Panel className="p-5" aria-live="polite">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Lightbulb className="size-4 text-warning" aria-hidden="true" /> Hints
              </h2>
              <ul className="mt-2 flex flex-col gap-2 text-sm text-fg-muted">
                {hints.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
