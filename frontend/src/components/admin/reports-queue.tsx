"use client";

import { AlertTriangle, Inbox } from "lucide-react";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { REPORT_REASONS, type ModerationAction, type ModerationReport, type ReportStatus } from "@/lib/api/types";
import { formatRoomCode } from "@/lib/room-code";
import { useApiQuery } from "@/lib/use-api-query";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Segmented, Select, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { EmptyState, LoadingBlock, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { AdminError } from "./admin-shell";

const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label])) as Record<string, string>;
const ACTIONS: { value: ModerationAction; label: string }[] = [
  { value: "dismiss", label: "Dismiss — no violation" },
  { value: "warn", label: "Warn the player" },
  { value: "remove_content", label: "Remove the content" },
  { value: "suspend", label: "Suspend the account" },
];
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ReportsQueue() {
  const [status, setStatus] = useState<ReportStatus>("open");
  const { data, error, loading, reload } = useApiQuery(`admin:reports:${status}`, (signal) => api.admin.reports(status, { signal }));

  return (
    <div className="flex flex-col gap-4">
      <div className="w-full max-w-xs">
        <Segmented legend="Queue" hideLegend name="report-status" value={status} onChange={setStatus} options={[{ value: "open", label: "Open" }, { value: "actioned", label: "Resolved" }]} />
      </div>
      {error && !data ? (
        <AdminError error={error} onRetry={reload} />
      ) : !data || (loading && !data) ? (
        <LoadingBlock label="Loading reports">
          <Skeleton className="h-40" />
        </LoadingBlock>
      ) : data.length === 0 ? (
        <EmptyState icon={<Inbox className="size-6" />} title={status === "open" ? "Queue is clear" : "No resolved reports yet"}>
          {status === "open" ? "New reports will appear here." : "Resolved reports and their notes show up here for audit."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((r) => (
            <li key={r.id}>
              <ReportCard report={r} onResolved={reload} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({ report, onResolved }: { report: ModerationReport; onResolved: () => void }) {
  const toast = useToast();
  const [action, setAction] = useState<ModerationAction | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const noteRequired = action !== "" && action !== "dismiss";
  const noteError = tried && noteRequired && note.trim().length < 5 ? "Add a short note for the audit log (5+ characters)." : null;

  async function resolve() {
    setTried(true);
    if (!action || (noteRequired && note.trim().length < 5)) return;
    setBusy(true);
    try {
      await api.admin.resolveReport(report.id, action, note);
      toast.success("Report resolved");
      onResolved();
    } catch (e) {
      toast.error("Couldn't resolve", describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar user={report.target} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {report.target.displayName}
            <Badge tone="violet">{REASON_LABEL[report.reason] ?? report.reason}</Badge>
            {report.priority === "high" && (
              <Badge tone="danger">
                <AlertTriangle className="size-3" aria-hidden="true" /> High priority
              </Badge>
            )}
          </p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {when.format(new Date(report.createdAt))}
            {report.roomCode && <> · Room <span className="font-mono">{formatRoomCode(report.roomCode)}</span></>} · Report {report.id}
          </p>
          {report.messageExcerpt && <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-sm text-fg-muted">{report.messageExcerpt}</blockquote>}
          {report.details && <p className="mt-2 text-sm text-fg">{report.details}</p>}
        </div>
      </div>

      {report.status === "open" ? (
        <div className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[16rem_1fr_auto] md:items-start">
          <Field label="Action">
            {(p) => (
              <Select {...p} value={action} onChange={(e) => setAction(e.target.value as ModerationAction)}>
                <option value="">Choose…</option>
                {ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Audit note" optional={!noteRequired} error={noteError}>
            {(p) => <Textarea {...p} className="min-h-11" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <Button className="md:mt-7" variant={action === "suspend" ? "danger" : "primary"} loading={busy} disabled={!action} onClick={() => void resolve()}>
            Resolve
          </Button>
        </div>
      ) : (
        report.resolution && (
          <p className="mt-4 border-t border-line pt-3 text-sm text-fg-muted">
            <span className="font-medium text-fg">{ACTIONS.find((a) => a.value === report.resolution!.action)?.label}</span> · {when.format(new Date(report.resolution.at))}
            {report.resolution.note && <> — {report.resolution.note}</>}
          </p>
        )
      )}
    </Panel>
  );
}
