"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { Difficulty, GameSummary } from "@/lib/api/types";
import { useApiQuery } from "@/lib/use-api-query";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { LoadingBlock, Skeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { DIFFICULTY_LABEL } from "@/components/games/meta";
import { AdminError } from "./admin-shell";

const ALL_DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/**
 * Catalog availability. Content authoring (new puzzles) is a backend/CMS job;
 * here staff can only enable/disable games and difficulty tiers that exist.
 */
export function CatalogManager() {
  const toast = useToast();
  const { data, error, reload } = useApiQuery("admin:catalog", (signal) => api.admin.catalog({ signal }));
  const [saving, setSaving] = useState<string | null>(null);

  if (error && !data) return <AdminError error={error} onRetry={reload} />;
  if (!data) {
    return (
      <LoadingBlock label="Loading catalog">
        <Skeleton className="h-64" />
      </LoadingBlock>
    );
  }

  async function update(game: GameSummary, patch: Partial<Pick<GameSummary, "enabled" | "difficulties">>) {
    setSaving(game.id);
    try {
      await api.admin.updateGame(game.id, patch);
      reload();
      toast.success(`${game.title} updated`);
    } catch (e) {
      toast.error("Update failed", describeError(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">Disabling a game hides it from the library and matchmaking. Rooms already running finish normally.</p>
      <ul className="flex flex-col gap-3">
        {data.map((g) => (
          <li key={g.id}>
            <Panel className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {g.title}
                  <Badge>{g.category}</Badge>
                  {g.modes.map((m) => (
                    <Badge key={m} tone="cyan">
                      {m}
                    </Badge>
                  ))}
                </p>
                <p className="mt-1 text-sm text-fg-muted">{g.tagline}</p>
                <fieldset className="mt-3" disabled={saving === g.id}>
                  <legend className="text-xs text-fg-subtle">Difficulty tiers offered</legend>
                  <div className="mt-1.5 flex flex-wrap gap-3">
                    {ALL_DIFFICULTIES.map((d) => {
                      const on = g.difficulties.includes(d);
                      return (
                        <label key={d} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-violet-400"
                            checked={on}
                            onChange={() => {
                              const next = on ? g.difficulties.filter((x) => x !== d) : ALL_DIFFICULTIES.filter((x) => x === d || g.difficulties.includes(x));
                              void update(g, { difficulties: next });
                            }}
                          />
                          {DIFFICULTY_LABEL[d]}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
              <div className="md:w-48">
                <Switch checked={g.enabled} disabled={saving === g.id} onCheckedChange={(enabled) => void update(g, { enabled })} label={g.enabled ? "Enabled" : "Disabled"} />
              </div>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
