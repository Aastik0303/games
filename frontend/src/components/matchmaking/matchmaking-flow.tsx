"use client";

import { Search, Sparkles, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/api";
import { INTERESTS, LANGUAGES, type Difficulty, type Interest, type LanguageCode } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { notify, playCue } from "@/lib/cues";
import { getRealtime, useRealtimeStatus } from "@/lib/realtime";
import { formatRoomCode } from "@/lib/room-code";
import { useDeviceSettings } from "@/lib/settings";
import { useApiQuery } from "@/lib/use-api-query";
import { useFlags } from "@/components/providers/flags-provider";
import { useSession } from "@/components/providers/session-provider";
import { DIFFICULTY_LABEL, KIND_META } from "@/components/games/meta";
import { Button } from "@/components/ui/button";
import { ChipGroup, Field, Segmented, Select } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from "@/components/ui/states";
import { matchReducer, PHASE_COPY } from "./match-reducer";

function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function MatchmakingFlow() {
  const { session } = useSession();
  const flags = useFlags();
  const router = useRouter();
  const params = useSearchParams();
  const settings = useDeviceSettings();
  const rtStatus = useRealtimeStatus();
  const catalog = useApiQuery("catalog", (signal) => api.catalog.list({ signal }));
  const [state, dispatch] = useReducer(matchReducer, { step: "configure" });

  const profile = session?.profile;
  const [gameId, setGameId] = useState<string>(params.get("game") ?? "");
  const [groupSize, setGroupSize] = useState(2);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [language, setLanguage] = useState<LanguageCode>(profile?.language ?? "en");
  const [interests, setInterests] = useState<Interest[]>(profile?.consent.useInterestsForMatching ? profile.interests : []);

  const ticketId = state.step === "searching" || state.step === "cancelling" || state.step === "matched" ? state.ticketId : null;
  const ticketRef = useRef<string | null>(null);
  const activeTicket = state.step === "searching" ? state.ticketId : null;
  useEffect(() => {
    ticketRef.current = activeTicket;
  }, [activeTicket]);

  // Listen for this ticket's events and (re)register interest whenever the socket opens.
  useEffect(() => {
    if (!ticketId) return;
    const rt = getRealtime();
    rt.connect();
    return rt.on((event) => {
      if (event.type === "matchmaking.status") dispatch({ type: "status", ticketId: event.payload.ticketId, phase: event.payload.phase });
      if (event.type === "matchmaking.matched") dispatch({ type: "matched", ticketId: event.payload.ticketId, roomCode: event.payload.roomCode });
    });
  }, [ticketId]);

  useEffect(() => {
    if (state.step !== "searching" || rtStatus !== "open") return;
    getRealtime().send("matchmaking.watch", { ticketId: state.ticketId }).catch(() => {});
  }, [state, rtStatus]);

  // Leaving the page (or Activity hiding it) cancels an active search.
  useEffect(
    () => () => {
      const id = ticketRef.current;
      if (id) {
        void api.matchmaking.cancel(id).catch(() => {});
        dispatch({ type: "reset" });
      }
    },
    [],
  );

  // On match: cue, notify, then move into the room.
  useEffect(() => {
    if (state.step !== "matched") return;
    playCue("match", settings);
    notify("Match found", "Your Prism group is ready.", settings);
    const t = setTimeout(() => router.push(`/rooms/${state.roomCode}`), 1200);
    return () => clearTimeout(t);
  }, [state, router, settings]);

  const elapsed = useElapsed(state.step === "searching" ? state.startedAt : null);

  if (flags && !flags.multiplayer) {
    return <EmptyState title="Matchmaking is paused">Multiplayer is temporarily unavailable. Solo games still work.</EmptyState>;
  }
  if (catalog.error && !catalog.data) {
    return <ErrorState actions={<Button onClick={catalog.reload}>Retry</Button>}>{describeError(catalog.error)}</ErrorState>;
  }
  if (!catalog.data) {
    return (
      <LoadingBlock label="Loading activities">
        <Skeleton className="h-96" />
      </LoadingBlock>
    );
  }

  const games = catalog.data.filter((g) => g.modes.includes("multiplayer"));
  const game = games.find((g) => g.id === gameId) ?? games[0];
  if (!game) return <EmptyState title="No multiplayer games right now">Check back soon, or try a solo game.</EmptyState>;
  const maxSize = Math.min(4, game.maxPlayers);
  const minSize = Math.max(2, game.minPlayers);
  const size = Math.min(maxSize, Math.max(minSize, groupSize));
  const diff = game.difficulties.includes(difficulty) ? difficulty : game.difficulties[0];

  async function start(e: FormEvent) {
    e.preventDefault();
    dispatch({ type: "enqueue" });
    try {
      const ticket = await api.matchmaking.enqueue({ gameId: game.id, groupSize: size, difficulty: diff, language, interests });
      dispatch({ type: "enqueued", ticketId: ticket.ticketId, at: Date.parse(ticket.createdAt) });
    } catch (err) {
      dispatch({ type: "enqueue_failed", message: describeError(err) });
    }
  }

  async function cancel() {
    if (state.step !== "searching") return;
    const id = state.ticketId;
    dispatch({ type: "cancel" });
    try {
      await api.matchmaking.cancel(id);
    } finally {
      dispatch({ type: "cancelled" });
    }
  }

  if (state.step === "searching" || state.step === "cancelling" || state.step === "matched") {
    const matched = state.step === "matched";
    return (
      <Panel featured className="mx-auto flex max-w-xl flex-col items-center px-6 py-12 text-center">
        <div className="relative flex size-28 items-center justify-center" aria-hidden="true">
          <span className={cn("absolute inset-0 rounded-full border border-violet-400/30", !matched && "animate-ping")} />
          <span className="absolute inset-3 rounded-full border border-cyan-400/30" />
          <span className={cn("prism-bar flex size-16 items-center justify-center rounded-full text-ink-950", matched && "shadow-[var(--shadow-glow)]")}>
            {matched ? <Sparkles className="size-7" /> : <Search className="size-7" />}
          </span>
        </div>
        <div role="status" aria-live="polite" className="mt-8">
          <h2 className="font-display text-2xl font-semibold">
            {matched ? "Match found!" : state.step === "cancelling" ? "Cancelling…" : PHASE_COPY[state.phase]}
          </h2>
          <p className="mt-2 text-sm text-fg-muted">
            {matched
              ? `Joining room ${formatRoomCode(state.roomCode)}…`
              : `${game.title} · ${size} players · ${DIFFICULTY_LABEL[diff]}`}
          </p>
        </div>
        {state.step === "searching" && (
          <>
            <p className="mt-4 text-xs text-fg-subtle tabular-nums">
              Searching for {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              {rtStatus !== "open" && " · reconnecting to updates…"}
            </p>
            <p className="mt-1 text-xs text-fg-subtle">Wait times depend on who&apos;s online, so we don&apos;t guess.</p>
            <Button className="mt-8" variant="outline" icon={<X className="size-4" />} onClick={() => void cancel()}>
              Cancel search
            </Button>
          </>
        )}
      </Panel>
    );
  }

  return (
    <form onSubmit={start} className="flex flex-col gap-6">
      {state.step === "configure" && state.notice && (
        <div role="alert" className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          {state.notice}
        </div>
      )}
      <Panel className="p-5 sm:p-6">
        <fieldset>
          <legend className="font-display text-lg font-semibold">1. What do you want to play?</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {games.map((g) => {
              const Icon = KIND_META[g.kind].icon;
              const checked = g.id === game.id;
              return (
                <label
                  key={g.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cyan-300",
                    checked ? "border-violet-400/60 bg-violet-400/10" : "border-line hover:border-line-strong",
                  )}
                >
                  <input type="radio" name="match-game" value={g.id} checked={checked} onChange={() => setGameId(g.id)} className="sr-only" />
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-strong", checked ? "text-violet-300" : "text-fg-muted")} aria-hidden="true">
                    <Icon className="size-5" />
                  </span>
                  <span>
                    <span className="block font-medium">{g.title}</span>
                    <span className="block text-sm text-fg-muted">{g.tagline}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Panel>

      <Panel className="grid gap-6 p-5 sm:p-6 md:grid-cols-2">
        <h2 className="font-display text-lg font-semibold md:col-span-2">2. Your group</h2>
        <Segmented
          legend="Group size"
          name="group-size"
          value={size}
          onChange={setGroupSize}
          options={Array.from({ length: maxSize - minSize + 1 }, (_, i) => ({ value: minSize + i, label: `${minSize + i} players` }))}
        />
        {game.difficulties.length > 1 && (
          <Segmented legend="Difficulty" name="match-difficulty" value={diff} onChange={setDifficulty} options={game.difficulties.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))} />
        )}
        <Field label="Chat language" hint="We'll look for people who can chat in this language.">
          {(p) => (
            <Select {...p} value={language} onChange={(e) => setLanguage(e.target.value as LanguageCode)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="md:col-span-2">
          <p className="text-sm font-medium">
            Shared interests <span className="text-xs font-normal text-fg-subtle">(optional)</span>
          </p>
          <p className="mb-3 mt-0.5 text-xs text-fg-subtle">Used only for this search to break ties between equally good groups. Fair queue time always comes first.</p>
          <ChipGroup label="Interests for this search" options={INTERESTS} value={interests} onChange={setInterests} max={5} />
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="lg" loading={state.step === "enqueuing"} icon={<Search className="size-4" />}>
          Find players
        </Button>
      </div>
    </form>
  );
}
