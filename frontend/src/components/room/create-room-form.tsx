"use client";

import { Lock, Tv, Unlock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/api";
import type { Difficulty, GameSummary, RoomPrivacy } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { useApiQuery } from "@/lib/use-api-query";
import { useFlags } from "@/components/providers/flags-provider";
import { DIFFICULTY_LABEL, KIND_META } from "@/components/games/meta";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { ErrorState, LoadingBlock, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

type Choice = { kind: "game"; game: GameSummary } | { kind: "watch" };

export function CreateRoomForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const flags = useFlags();
  const catalog = useApiQuery("catalog", (signal) => api.catalog.list({ signal }));
  const games = (catalog.data ?? []).filter((g) => g.modes.includes("multiplayer"));
  const [choiceId, setChoiceId] = useState<string>(params.get("activity") === "watch" ? "watch" : "");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [capacity, setCapacity] = useState(4);
  const [privacy, setPrivacy] = useState<RoomPrivacy>("private");
  const [busy, setBusy] = useState(false);

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

  const effectiveId = choiceId || games[0]?.id || (flags?.watchTogether ? "watch" : "");
  const choice: Choice | null =
    effectiveId === "watch" ? { kind: "watch" } : (() => {
      const g = games.find((x) => x.id === effectiveId);
      return g ? { kind: "game", game: g } : null;
    })();
  const [minCap, maxCap] = choice?.kind === "game" ? [Math.max(2, choice.game.minPlayers), choice.game.maxPlayers] : [2, 8];
  const cap = Math.min(maxCap, Math.max(minCap, capacity));
  const diff = choice?.kind === "game" && !choice.game.difficulties.includes(difficulty) ? choice.game.difficulties[0] : difficulty;
  const watchDisabled = flags !== null && !flags.watchTogether;
  const multiplayerDisabled = flags !== null && !flags.multiplayer;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!choice) return;
    setBusy(true);
    try {
      const room = await api.rooms.create({
        activity: choice.kind === "watch" ? { kind: "watch" } : { kind: choice.game.kind, gameId: choice.game.id, difficulty: diff },
        capacity: cap,
        privacy,
      });
      router.push(`/rooms/${room.code}`);
    } catch (err) {
      toast.error("Couldn't create the room", describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Panel className="p-5 sm:p-6">
        <fieldset>
          <legend className="font-display text-lg font-semibold">1. Choose the activity</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((g) => {
              const Icon = KIND_META[g.kind].icon;
              return (
                <ActivityOption key={g.id} id={g.id} checked={effectiveId === g.id} disabled={multiplayerDisabled} onSelect={setChoiceId} title={g.title} subtitle={`${g.minPlayers}–${g.maxPlayers} players · ${g.turnMode === "turns" ? "take turns" : "everyone answers"}`} icon={<Icon className="size-5" />} />
              );
            })}
            <ActivityOption id="watch" checked={effectiveId === "watch"} disabled={watchDisabled} onSelect={setChoiceId} title="Watch Together" subtitle={watchDisabled ? "Currently unavailable" : "Synced video, 2–8 people"} icon={<Tv className="size-5" />} />
          </div>
          {multiplayerDisabled && <p className="mt-3 text-sm text-warning">Multiplayer games are temporarily unavailable.</p>}
        </fieldset>
      </Panel>

      <Panel className="grid gap-6 p-5 sm:p-6 md:grid-cols-2">
        <h2 className="font-display text-lg font-semibold md:col-span-2">2. Room settings</h2>
        {choice?.kind === "game" && choice.game.difficulties.length > 1 && (
          <Segmented legend="Difficulty" name="create-difficulty" value={diff} onChange={setDifficulty} options={choice.game.difficulties.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))} />
        )}
        <Segmented
          legend="Seats (including you)"
          name="create-capacity"
          value={cap}
          onChange={setCapacity}
          options={Array.from({ length: maxCap - minCap + 1 }, (_, i) => ({ value: minCap + i, label: String(minCap + i) }))}
        />
        <Segmented
          legend="Who can join"
          name="create-privacy"
          value={privacy}
          onChange={setPrivacy}
          options={[
            { value: "private", label: <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden="true" />Code only</span> },
            { value: "open", label: <span className="inline-flex items-center gap-1.5"><Unlock className="size-3.5" aria-hidden="true" />Open</span> },
          ]}
        />
        <p className="text-xs text-fg-subtle md:col-span-2">
          {privacy === "private" ? "Only people you give the code to can join." : "Matchmaking can fill empty seats with compatible players. You can switch to private later."}
        </p>
      </Panel>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!choice}>
          Create room
        </Button>
      </div>
    </form>
  );
}

function ActivityOption({ id, checked, disabled, onSelect, title, subtitle, icon }: { id: string; checked: boolean; disabled?: boolean; onSelect: (id: string) => void; title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cyan-300",
        checked ? "border-violet-400/60 bg-violet-400/10" : "border-line hover:border-line-strong",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input type="radio" name="activity" value={id} checked={checked} disabled={disabled} onChange={() => onSelect(id)} className="sr-only" />
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-strong", checked ? "text-violet-300" : "text-fg-muted")} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-fg-subtle">{subtitle}</span>
      </span>
    </label>
  );
}
