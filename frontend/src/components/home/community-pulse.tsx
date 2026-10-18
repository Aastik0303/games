"use client";

import { Activity } from "lucide-react";
import { api } from "@/lib/api";
import { IS_MOCK } from "@/lib/config";
import { useApiQuery } from "@/lib/use-api-query";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/states";

const ACTIVITY_COPY = { quiet: "Quiet right now", steady: "Steady activity", busy: "Busy — lots of rooms open" } as const;
const fmt = new Intl.NumberFormat();

export function CommunityPulse() {
  const { data, error, loading } = useApiQuery("pulse", (signal) => api.community.pulse({ signal }), { refreshMs: 30_000 });

  return (
    <Panel as="aside" aria-labelledby="pulse-title" className="h-full p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="pulse-title" className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span className="relative flex size-2.5" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success" />
          </span>
          Community pulse
        </h2>
        {IS_MOCK && <Badge tone="warning">Mock data</Badge>}
      </div>

      {!data && loading ? (
        <div className="mt-5 grid grid-cols-2 gap-3" aria-busy="true">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="col-span-2 h-20" />
        </div>
      ) : !data || error ? (
        <p className="mt-4 text-sm text-fg-muted">Live stats are unavailable right now. Everything else still works.</p>
      ) : (
        <div className="mt-4" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Activity className="size-4 text-cyan-300" aria-hidden="true" /> {ACTIVITY_COPY[data.activity]}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-white/[0.02] p-3">
              <dt className="text-xs text-fg-subtle">Players online</dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">{data.playersOnline === null ? "—" : fmt.format(data.playersOnline)}</dd>
            </div>
            <div className="rounded-xl border border-line bg-white/[0.02] p-3">
              <dt className="text-xs text-fg-subtle">Live rooms</dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums">{data.activeRooms === null ? "—" : fmt.format(data.activeRooms)}</dd>
            </div>
          </dl>
          {data.trending.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-fg-subtle">Popular now</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {data.trending.map((t) => (
                  <li key={t.gameId} className="flex items-center justify-between text-sm">
                    <span className="text-fg">{t.title}</span>
                    <span className="text-xs text-fg-subtle">{t.liveRooms > 0 ? `${t.liveRooms} live rooms` : "Solo"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
