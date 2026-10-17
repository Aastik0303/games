"use client";

import { Film, Undo2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { mockDev } from "@/lib/api";
import type { Room, WatchState } from "@/lib/api/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";
import { useFlags } from "@/components/providers/flags-provider";
import { realtimeErrorMessage, type RoomController } from "@/components/room/use-room";
import { ScreenShare } from "./screen-share";
import { SyncPlayer } from "./sync-player";
import { validateSourceUrl } from "./sync";

export function WatchStage({
  room,
  watch,
  selfId,
  actions,
  connected,
}: {
  room: Room;
  watch: WatchState;
  selfId: string;
  actions: RoomController["actions"];
  connected: boolean;
}) {
  const toast = useToast();
  const flags = useFlags();
  const stageRef = useRef<HTMLDivElement>(null);
  const [changing, setChanging] = useState(false);
  const isHost = room.hostId === selfId;
  const canControl = connected && (watch.controlPolicy === "everyone" || isHost);
  const showPicker = isHost && (!watch.source || changing);

  return (
    <div className="flex flex-col gap-3">
      {/* Media first: the stage takes the width; people are a slim strip below. */}
      <div ref={stageRef} className="relative overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-black shadow-[var(--shadow-panel)]">
        <div className="aspect-video max-h-[calc(100dvh-14rem)] w-full [:fullscreen_&]:aspect-auto [:fullscreen_&]:h-dvh [:fullscreen_&]:max-h-none">
          {watch.source && !changing ? (
            <SyncPlayer
              state={watch}
              canControl={canControl}
              stageRef={stageRef}
              onControl={(action, pos) => actions.watchControl(action, pos).catch((e) => toast.error("Playback command failed", realtimeErrorMessage(e)))}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              {showPicker ? (
                <SourcePicker
                  onCancel={watch.source ? () => setChanging(false) : undefined}
                  onPick={async (url, title) => {
                    try {
                      await actions.setSource({ kind: "url", url, title });
                      setChanging(false);
                    } catch (e) {
                      toast.error("Couldn't load that video", realtimeErrorMessage(e));
                    }
                  }}
                />
              ) : (
                <div className="text-center text-fg-muted" role="status">
                  <Film className="mx-auto size-8 text-violet-300" aria-hidden="true" />
                  <p className="mt-3">Waiting for the host to choose something to watch…</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Panel className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{watch.source?.title ?? "Nothing playing"}</p>
          <p className="text-xs text-fg-subtle">{isHost ? "You control playback for everyone." : "The host controls playback; volume, captions and full screen are yours."}</p>
        </div>
        <ul className="flex -space-x-2" aria-label="Watching now">
          {room.participants.map((p) => (
            <li key={p.user.id} title={p.user.displayName} className="rounded-full ring-2 ring-ink-900">
              <Avatar user={p.user} size="sm" />
              <span className="sr-only">{p.user.displayName}</span>
            </li>
          ))}
        </ul>
        {isHost && (
          <div className="flex gap-2">
            {watch.source && !changing && (
              <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
                Change video
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => void actions.endActivity().catch((e) => toast.error("Couldn't end", realtimeErrorMessage(e)))}>
              End
            </Button>
          </div>
        )}
      </Panel>

      {flags?.screenShare && (
        <Panel className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Screen share</h3>
            <Badge tone="warning">Preview</Badge>
          </div>
          <ScreenShare />
        </Panel>
      )}
    </div>
  );
}

function SourcePicker({ onPick, onCancel }: { onPick: (url: string, title: string) => Promise<void>; onCancel?: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateSourceUrl(url);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await onPick(url.trim(), title.trim() || new URL(url).pathname.split("/").pop() || "Shared video");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass-strong w-full max-w-lg rounded-2xl p-5 text-left">
      <h3 className="font-display text-lg font-semibold">Choose something to watch</h3>
      <p className="mt-1 text-xs text-fg-subtle">
        Paste a direct https link to a video file you&apos;re allowed to share (for example .mp4 or .webm). Streaming services that use DRM can&apos;t be played or captured.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <Field label="Video link" error={error}>
          {(p) => <Input {...p} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/video.mp4" />}
        </Field>
        <Field label="Title" optional>
          {(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {mockDev && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => {
              setUrl(mockDev?.sampleWatchSource.url ?? "");
              setTitle(mockDev?.sampleWatchSource.title ?? "");
            }}
          >
            Use sample (CC BY)
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Load for everyone
        </Button>
      </div>
    </form>
  );
}
