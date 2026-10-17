"use client";

import { Ban, Flag } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/api";
import { REPORT_REASONS, type PublicUser, type ReportReason } from "@/lib/api/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export interface ModerationTarget {
  user: PublicUser;
  messageId?: string;
  excerpt?: string;
}

/** Report and/or block a player. Reports go to human moderators with room context. */
export function ModerationDialog({
  target,
  roomId,
  onClose,
  onBlock,
}: {
  target: ModerationTarget | null;
  roomId: string;
  onClose: () => void;
  onBlock: (userId: string) => Promise<void>;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target && (
        <DialogContent title={`Report or block ${target.user.displayName}`} description="Reports are confidential — the player won't know who reported them.">
          <ModerationForm key={target.user.id + (target.messageId ?? "")} target={target} roomId={roomId} onClose={onClose} onBlock={onBlock} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ModerationForm({ target, roomId, onClose, onBlock }: { target: ModerationTarget; roomId: string; onClose: () => void; onBlock: (userId: string) => Promise<void> }) {
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState<"report" | "block" | null>(null);
  const [tried, setTried] = useState(false);

  async function report(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!reason) return;
    setBusy("report");
    try {
      await api.moderation.report({ targetUserId: target.user.id, roomId, messageId: target.messageId, reason, details: details.trim() || undefined });
      if (alsoBlock) await onBlock(target.user.id);
      toast.success("Report sent", alsoBlock ? `You won't see ${target.user.displayName} anymore.` : "Thanks — a moderator will review it.");
      onClose();
    } catch (err) {
      toast.error("Couldn't send report", describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function blockOnly() {
    setBusy("block");
    try {
      await onBlock(target.user.id);
      toast.success(`Blocked ${target.user.displayName}`, "You can unblock from Settings.");
      onClose();
    } catch (err) {
      toast.error("Couldn't block", describeError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={report} className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl border border-line p-3">
        <Avatar user={target.user} />
        <div className="min-w-0">
          <p className="text-sm font-medium">{target.user.displayName}</p>
          {target.excerpt && <p className="truncate text-xs text-fg-subtle">“{target.excerpt}”</p>}
        </div>
      </div>
      <Field label="What's the problem?" error={tried && !reason ? "Choose a reason." : null}>
        {(p) => (
          <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
            <option value="">Choose a reason…</option>
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Anything else moderators should know?" optional hint={`${details.length}/500`}>
        {(p) => <Textarea {...p} value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} />}
      </Field>
      <Checkbox checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} label={`Also block ${target.user.displayName}`} />
      {reason === "minor_safety" && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-fg">
          If someone is in immediate danger, contact local emergency services. Child-safety reports are prioritised for review.
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
        <Button variant="ghost" icon={<Ban className="size-4" />} loading={busy === "block"} disabled={busy !== null} onClick={() => void blockOnly()}>
          Block without reporting
        </Button>
        <Button type="submit" variant="danger" icon={<Flag className="size-4" />} loading={busy === "report"} disabled={busy !== null}>
          Send report
        </Button>
      </div>
    </form>
  );
}
