"use client";

import { Clock, Search, Users } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { Difficulty, GameCategory, GameSummary } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { useApiQuery } from "@/lib/use-api-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Segmented } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from "@/components/ui/states";
import { DIFFICULTY_LABEL, KIND_META } from "./meta";

const CATEGORIES: ("All" | GameCategory)[] = ["All", "Word", "Riddle", "Logic", "Mystery"];

export function filterGames(games: GameSummary[], q: string, category: "All" | GameCategory, difficulty: "any" | Difficulty) {
  const needle = q.trim().toLowerCase();
  return games.filter(
    (g) =>
      g.modes.includes("solo") &&
      (category === "All" || g.category === category) &&
      (difficulty === "any" || g.difficulties.includes(difficulty)) &&
      (!needle || g.title.toLowerCase().includes(needle) || g.tagline.toLowerCase().includes(needle)),
  );
}

export function GameCard({ game }: { game: GameSummary }) {
  const meta = KIND_META[game.kind];
  const Icon = meta.icon;
  return (
    <Link
      href={`/solo/${game.id}`}
      className="glass group flex h-full flex-col rounded-[var(--radius-panel)] p-5 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-glow)]"
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex size-11 items-center justify-center rounded-2xl border border-line-strong bg-white/[0.04]", meta.accent)} aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <Badge>{game.category}</Badge>
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold tracking-tight">{game.title}</h3>
      <p className="mt-1.5 flex-1 text-sm text-fg-muted">{game.tagline}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-subtle">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" aria-hidden="true" /> ~{game.estMinutes} min
        </span>
        {game.modes.includes("multiplayer") && (
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" aria-hidden="true" /> Also multiplayer
          </span>
        )}
        <span>{game.difficulties.map((d) => DIFFICULTY_LABEL[d]).join(" · ")}</span>
      </div>
    </Link>
  );
}

export function GameLibrary() {
  const { data, error, loading, reload } = useApiQuery("catalog", (signal) => api.catalog.list({ signal }));
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<"All" | GameCategory>("All");
  const [difficulty, setDifficulty] = useState<"any" | Difficulty>("any");
  const deferredQ = useDeferredValue(q);

  if (error && !data) {
    return (
      <ErrorState actions={<Button onClick={reload}>Retry</Button>} title="Couldn't load games">
        {describeError(error)}
      </ErrorState>
    );
  }

  const games = data ? filterGames(data, deferredQ, category, difficulty) : [];

  return (
    <div>
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
        <div className="relative">
          <label htmlFor="game-search" className="mb-1.5 block text-sm font-medium">
            Search games
          </label>
          <Search className="pointer-events-none absolute bottom-3.5 left-3.5 size-4 text-fg-subtle" aria-hidden="true" />
          <Input id="game-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Riddles, mystery…" className="pl-10" />
        </div>
        <Segmented legend="Category" name="category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <Segmented
          legend="Difficulty"
          name="difficulty"
          value={difficulty}
          onChange={setDifficulty}
          options={[
            { value: "any", label: "Any" },
            { value: "easy", label: "Easy" },
            { value: "medium", label: "Medium" },
            { value: "hard", label: "Hard" },
          ]}
        />
      </div>

      {loading && !data ? (
        <LoadingBlock label="Loading games">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-52" />
            ))}
          </div>
        </LoadingBlock>
      ) : games.length === 0 ? (
        <EmptyState
          title="No games match"
          actions={
            <Button
              onClick={() => {
                setQ("");
                setCategory("All");
                setDifficulty("any");
              }}
            >
              Clear filters
            </Button>
          }
        >
          Try a different search or category.
        </EmptyState>
      ) : (
        <>
          <p className="sr-only" aria-live="polite">
            {games.length} games shown
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((g) => (
              <li key={g.id}>
                <GameCard game={g} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
