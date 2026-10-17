"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { RoomHealth } from "@/lib/api/types";
import { formatRoomCode } from "@/lib/room-code";
import { useApiQuery } from "@/lib/use-api-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { LoadingBlock, Skeleton } from "@/components/ui/states";
import { AdminError } from "./admin-shell";
import { MatchesChart } from "./matches-chart";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const ISSUE_LABEL: Record<RoomHealth["issues"][number], string> = {
  stale_host: "Host inactive",
  high_reconnects: "Many reconnects",
  near_capacity: "At capacity",
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Panel className="p-4">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
    </Panel>
  );
}

function age(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

export function AdminOverview() {
  const { data, error, loading, reload } = useApiQuery("admin:overview", (signal) => api.admin.overview({ signal }), { refreshMs: 15_000 });

  if (error && !data) return <AdminError error={error} onRetry={reload} />;
  if (!data) {
    return (
      <LoadingBlock label="Loading overview">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="mt-4 h-64" />
      </LoadingBlock>
    );
  }

  const m = data.metrics;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
        <span>Updated {new Date(data.generatedAt).toLocaleTimeString()} · refreshes every 15s</span>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={reload}>
          Refresh
        </Button>
      </div>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Active users" value={compact.format(m.activeUsers)} />
        <StatTile label="Active rooms" value={compact.format(m.activeRooms)} />
        <StatTile label="Players in queue" value={compact.format(m.playersInQueue)} />
        <StatTile label="Matches last hour" value={compact.format(m.matchesLastHour)} />
        <StatTile label="Open reports" value={compact.format(m.openReports)} />
        <StatTile label="Reconnect rate" value={`${(m.reconnectRate * 100).toFixed(1)}%`} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Panel className="p-5">
          <MatchesChart data={data.hourlyMatches} />
        </Panel>
        <Panel className="p-5">
          <h3 className="text-sm font-semibold">Queue health</h3>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-fg-subtle">
                <th className="py-1.5 font-medium">Activity</th>
                <th className="py-1.5 text-right font-medium">Waiting</th>
                <th className="py-1.5 text-right font-medium">Median wait</th>
                <th className="py-1.5 text-right font-medium">Matches/h</th>
              </tr>
            </thead>
            <tbody>
              {data.queues.map((q) => (
                <tr key={q.gameId} className="border-t border-line">
                  <td className="py-2">{q.title}</td>
                  <td className="py-2 text-right tabular-nums">{q.waiting}</td>
                  <td className="py-2 text-right tabular-nums">{q.medianWaitSeconds === null ? "—" : `${q.medianWaitSeconds}s`}</td>
                  <td className="py-2 text-right tabular-nums">{q.matchesLastHour}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel className="overflow-hidden">
        <h3 className="px-5 pt-5 text-sm font-semibold">Room health</h3>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-fg-subtle">
                <th className="px-5 py-2 font-medium">Code</th>
                <th className="py-2 font-medium">Activity</th>
                <th className="py-2 font-medium">Phase</th>
                <th className="py-2 text-right font-medium">Seats</th>
                <th className="py-2 text-right font-medium">Age</th>
                <th className="py-2 text-right font-medium">Reconnects/h</th>
                <th className="px-5 py-2 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {data.rooms.map((r) => (
                <tr key={r.roomId} className="border-t border-line">
                  <td className="px-5 py-2.5 font-mono">{formatRoomCode(r.code)}</td>
                  <td className="py-2.5 capitalize">{r.activity}</td>
                  <td className="py-2.5 capitalize">{r.phase}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {r.participants}/{r.capacity}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{age(r.ageSeconds)}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.reconnectsLastHour}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.issues.length === 0 ? (
                        <span className="text-xs text-fg-subtle">—</span>
                      ) : (
                        r.issues.map((i) => (
                          <Badge key={i} tone={i === "near_capacity" ? "neutral" : "warning"}>
                            {i !== "near_capacity" && <AlertTriangle className="size-3" aria-hidden="true" />}
                            {ISSUE_LABEL[i]}
                          </Badge>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
