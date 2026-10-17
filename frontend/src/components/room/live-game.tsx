"use client";

import { CheckCircle2, Crown, Hourglass, RotateCcw, Undo2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GameState, PuzzleAnswer, Room } from "@/lib/api/types";
import { playCue, notify } from "@/lib/cues";
import { useDeviceSettings } from "@/lib/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";
import { PuzzleView } from "@/components/games/puzzle-view";
import { SharedTimer } from "./shared-timer";
import { realtimeErrorMessage, type RoomController } from "./use-room";

interface RoundFeedback {
  round: number;
  correct: boolean;
  attemptsLeft: number;
}

export function rankScores(room: Room, game: GameState) {
  return room.participants
    .map((p) => ({ user: p.user, score: game.scores[p.user.id] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.user.displayName.localeCompare(b.user.displayName));
}

export function LiveGame({
  room,
  game,
  selfId,
  actions,
  connected,
}: {
  room: Room;
  game: GameState;
  selfId: string;
  actions: RoomController["actions"];
  connected: boolean;
}) {
  const toast = useToast();
  const settings = useDeviceSettings();
  const [feedback, setFeedback] = useState<RoundFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const isHost = room.hostId === selfId;
  const nameOf = (id: string) => (id === selfId ? "You" : room.participants.find((p) => p.user.id === id)?.user.displayName ?? "A player");

  const roundFeedback = feedback?.round === game.round ? feedback : null;
  const solved = game.solvedBy.includes(selfId);
  const myTurn = game.turn.mode === "simultaneous" || game.turn.activeUserId === selfId;
  const outOfAttempts = roundFeedback !== null && roundFeedback.attemptsLeft <= 0;
  const canAnswer = connected && game.phase === "answering" && myTurn && !solved && !outOfAttempts;

  // Turn cue: fires once when it becomes this player's turn.
  const lastTurnRound = useRef(0);
  useEffect(() => {
    if (game.phase === "answering" && game.turn.mode === "turns" && game.turn.activeUserId === selfId && lastTurnRound.current !== game.round) {
      lastTurnRound.current = game.round;
      playCue("turn", settings);
      notify("Your turn on Prism", `Round ${game.round} of ${game.title}`, settings);
    }
  }, [game.phase, game.round, game.turn, game.title, selfId, settings]);

  async function submit(answer: PuzzleAnswer): Promise<boolean> {
    setBusy(true);
    try {
      const result = await actions.submitAnswer(game.round, answer);
      setFeedback({ round: game.round, correct: result.correct, attemptsLeft: result.attemptsLeft });
      if (result.correct) playCue("correct", settings);
      return true;
    } catch (e) {
      toast.error("Answer not sent", realtimeErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const ranked = rankScores(room, game);
  const top = ranked[0]?.score ?? 0;

  const disabledReason = !connected
    ? "Reconnecting…"
    : solved
      ? "Solved! Waiting for others"
      : !myTurn && game.turn.mode === "turns"
        ? `${nameOf(game.turn.activeUserId)} is answering`
        : outOfAttempts
          ? "No attempts left this round"
          : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-wrap items-center gap-3 px-5 py-3">
        <h2 className="font-display text-lg font-semibold">{game.title}</h2>
        {game.phase !== "finished" && game.round > 0 && (
          <Badge tone="violet">
            Round {game.round}/{game.totalRounds}
          </Badge>
        )}
        {game.turn.mode === "turns" && game.phase === "answering" && (
          <Badge tone={myTurn ? "success" : "neutral"} aria-live="polite">
            {myTurn ? "Your turn" : `${nameOf(game.turn.activeUserId)}'s turn`}
          </Badge>
        )}
        <div className="ml-auto">{game.phase !== "finished" && <SharedTimer endsAt={game.endsAt} label={game.phase === "countdown" ? "Starting in" : game.phase === "reveal" ? "Next round in" : "Time left"} />}</div>
      </Panel>

      <Panel featured className="min-h-80 p-5 sm:p-8">
        {game.phase === "countdown" && (
          <div className="flex min-h-64 flex-col items-center justify-center text-center" role="status">
            <Hourglass className="size-8 text-cyan-300" aria-hidden="true" />
            <p className="mt-4 font-display text-3xl font-semibold">Get ready…</p>
            <p className="mt-2 text-fg-muted">{game.totalRounds} rounds. {game.turn.mode === "turns" ? "Players take turns." : "Everyone answers at once — first correct answer scores most."}</p>
          </div>
        )}

        {game.phase === "answering" && game.puzzle && (
          <>
            <PuzzleView key={`${game.round}-${game.puzzle.id}`} puzzle={game.puzzle} onSubmit={submit} busy={busy} disabled={!canAnswer} disabledReason={disabledReason} />
            <div className="mt-5 min-h-6 text-sm" aria-live="polite">
              {roundFeedback &&
                (roundFeedback.correct ? (
                  <p className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="size-4" aria-hidden="true" /> Correct! Waiting for the round to finish.
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-danger">
                    <XCircle className="size-4" aria-hidden="true" /> Not quite.{" "}
                    {roundFeedback.attemptsLeft > 0 ? `${roundFeedback.attemptsLeft} ${roundFeedback.attemptsLeft === 1 ? "try" : "tries"} left.` : "No tries left this round."}
                  </p>
                ))}
              {!roundFeedback && game.solvedBy.length > 0 && (
                <p className="text-fg-muted">{game.solvedBy.map(nameOf).join(", ")} solved it.</p>
              )}
            </div>
          </>
        )}

        {game.phase === "reveal" && game.lastReveal && (
          <div className="flex min-h-64 flex-col items-center justify-center text-center" role="status">
            <p className="text-xs uppercase tracking-[0.16em] text-fg-subtle">The answer was</p>
            <p className="prism-text mt-2 font-display text-4xl font-semibold capitalize">{game.lastReveal.solution}</p>
            <p className="mt-4 text-fg-muted">
              {game.lastReveal.correctUserIds.length > 0 ? `Solved by ${game.lastReveal.correctUserIds.map(nameOf).join(", ")}` : "Nobody got this one."}
            </p>
          </div>
        )}

        {game.phase === "finished" && (
          <div className="flex flex-col items-center text-center" role="status">
            <Crown className="size-9 text-warning" aria-hidden="true" />
            <h3 className="mt-3 font-display text-3xl font-semibold">Game over</h3>
            <p className="mt-1 text-fg-muted">
              {top === 0 ? "No points this time — rematch?" : `${ranked.filter((r) => r.score === top).map((r) => (r.user.id === selfId ? "You" : r.user.displayName)).join(" & ")} ${ranked.filter((r) => r.score === top).length > 1 ? "tie" : "win"} with ${top} points`}
            </p>
            <ol className="mt-6 w-full max-w-sm text-left">
              {ranked.map((r, i) => (
                <li key={r.user.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                  <span className="w-6 font-display font-semibold text-fg-subtle tabular-nums">{i + 1}</span>
                  <span className="flex-1 truncate">{r.user.id === selfId ? "You" : r.user.displayName}</span>
                  <span className="font-display font-semibold tabular-nums">{r.score}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {isHost ? (
                <>
                  <Button variant="primary" icon={<RotateCcw className="size-4" />} disabled={!connected} onClick={() => void actions.start().catch((e) => toast.error("Couldn't restart", realtimeErrorMessage(e)))}>
                    Play again
                  </Button>
                  <Button icon={<Undo2 className="size-4" />} disabled={!connected} onClick={() => void actions.endActivity().catch((e) => toast.error("Couldn't return to lobby", realtimeErrorMessage(e)))}>
                    Back to lobby
                  </Button>
                </>
              ) : (
                <p className="text-sm text-fg-muted">Waiting for the host to start another round or return to the lobby.</p>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
