"use client";

import { Check, Crown, MoreHorizontal, UserMinus, WifiOff } from "lucide-react";
import type { Participant, Room } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { ModerationTarget } from "./moderation-dialog";

export function ParticipantList({
  room,
  selfId,
  showReady,
  scores,
  onKick,
  onModerate,
}: {
  room: Room;
  selfId: string;
  showReady: boolean;
  scores?: Record<string, number>;
  onKick?: (p: Participant) => void;
  onModerate: (target: ModerationTarget) => void;
}) {
  const isHost = room.hostId === selfId;
  return (
    <div>
      <p className="mb-2 text-xs text-fg-subtle">
        {room.participants.length} of {room.capacity} seats
      </p>
      <ul className="flex flex-col gap-1.5">
        {room.participants.map((p) => {
          const self = p.user.id === selfId;
          return (
            <li key={p.user.id} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
              <span className="relative">
                <Avatar user={p.user} />
                <span
                  className={cn(
                    "absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-ink-800",
                    p.connection === "online" ? "bg-success" : p.connection === "reconnecting" ? "bg-warning" : "bg-fg-subtle",
                  )}
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{p.user.displayName}</span>
                  {self && <span className="text-xs font-normal text-fg-subtle">(you)</span>}
                  {p.role === "host" && (
                    <Badge tone="warning" className="px-1.5">
                      <Crown className="size-3" aria-hidden="true" /> Host
                    </Badge>
                  )}
                  {p.user.isBot && <Badge className="px-1.5">Mock player</Badge>}
                </p>
                <p className="flex items-center gap-1 text-xs text-fg-subtle">
                  {p.connection !== "online" ? (
                    <>
                      <WifiOff className="size-3 text-warning" aria-hidden="true" />
                      {p.connection === "reconnecting" ? "Reconnecting…" : "Offline"}
                    </>
                  ) : showReady ? (
                    p.ready || p.role === "host" ? (
                      <>
                        <Check className="size-3 text-success" aria-hidden="true" /> {p.role === "host" ? "Hosting" : "Ready"}
                      </>
                    ) : (
                      "Not ready"
                    )
                  ) : (
                    "Online"
                  )}
                </p>
              </div>
              {scores && (
                <span className="font-display text-lg font-semibold tabular-nums" aria-label={`${scores[p.user.id] ?? 0} points`}>
                  {scores[p.user.id] ?? 0}
                </span>
              )}
              {!self && (
                <div className="flex shrink-0">
                  {isHost && onKick && (
                    <button
                      type="button"
                      onClick={() => onKick(p)}
                      className="rounded-md p-1.5 text-fg-subtle hover:bg-white/8 hover:text-danger"
                      aria-label={`Remove ${p.user.displayName} from room`}
                    >
                      <UserMinus className="size-4" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onModerate({ user: p.user })}
                    className="rounded-md p-1.5 text-fg-subtle hover:bg-white/8 hover:text-fg"
                    aria-label={`Report or block ${p.user.displayName}`}
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {Array.from({ length: Math.max(0, room.capacity - room.participants.length) }, (_, i) => (
          <li key={`empty-${i}`} className="flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-fg-subtle">
            <span className="size-9 rounded-full border border-dashed border-line-strong" aria-hidden="true" />
            Open seat
          </li>
        ))}
      </ul>
    </div>
  );
}
