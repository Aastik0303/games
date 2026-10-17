"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { Panel } from "@/components/ui/panel";
import { LoadingBlock, Skeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { AdminError } from "./admin-shell";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function FlagsPanel() {
  const toast = useToast();
  const { data, error, reload } = useApiQuery("admin:flags", (signal) => api.admin.flags({ signal }));
  const [saving, setSaving] = useState<string | null>(null);

  if (error && !data) return <AdminError error={error} onRetry={reload} />;
  if (!data) {
    return (
      <LoadingBlock label="Loading flags">
        <Skeleton className="h-64" />
      </LoadingBlock>
    );
  }

  return (
    <Panel className="divide-y divide-line">
      <p className="p-5 text-sm text-fg-muted">Changes apply to clients on their next flag refresh (about two minutes). Every change is recorded in the audit log server-side.</p>
      {data.map((flag) => (
        <div key={flag.key} className="flex flex-col gap-1 p-5">
          <Switch
            checked={flag.enabled}
            disabled={saving === flag.key}
            label={<span className="font-mono text-sm">{flag.key}</span>}
            description={flag.description}
            onCheckedChange={async (enabled) => {
              setSaving(flag.key);
              try {
                await api.admin.setFlag(flag.key, enabled);
                reload();
              } catch (e) {
                toast.error("Couldn't change flag", describeError(e));
              } finally {
                setSaving(null);
              }
            }}
          />
          <p className="text-xs text-fg-subtle">Last changed {when.format(new Date(flag.updatedAt))}</p>
        </div>
      ))}
    </Panel>
  );
}
