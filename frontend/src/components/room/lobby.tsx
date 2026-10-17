"use client";

import { Bot, Check, Lock, Play, Tv, Unlock } from "lucide-react";
import { useState } from "react";
import { mockDev, describeError } from "@/lib/api";
import type { ActivityKind, Difficulty, GameSummary, Room, RoomActivity } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Segmented, Select } from "@/components/ui/field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";
import { DIFFICULTY_LABEL, KIND_META } from "@/components/games/meta";
import { useFlags } from "@/components/providers/flags-provider";
import { InviteCode } from "./invite-code";
import { capacityOptions, startBlockers } from "./lobby-rules";
import { realtimeErrorMessage, type RoomController } from "./use-room";

export function Lobby({
  room,
  selfId,
  games,
  actions,
  connected,
}: {
  room: Room;
  selfId: string;
  games: GameSummary[];
  actions: RoomController["actions"];
  connected: boolean;
}) {
  const toast = useToast();
  const flags = useFlags();
  const [pending, setPending] = useState<string | null>(null);
  const isHost = room.hostId === selfId;
  const self = room.participants.find((p) => p.user.id === selfId);
  const game = room.activity.kind === "watch" ? null : games.find((g) => g.id === room.activity.gameId) ?? null;
  const blockers = startBlockers(room, game);
  const multiplayerGames = games.filter((g) => g.modes.includes("multiplayer"));

  async function run(label: string, fn: () => Promise<unknown>) {
    setPending(label);
    try {
      await fn();
    } catch (e) {
      toast.error("Couldn't update the room", realtimeErrorMessage(e));
    } finally {
      setPending(null);
    }
  }

  const changeActivity = (value: string) => {
    let activity: RoomActivity;
    if (value === "watch") activity = { kind: "watch" };
    else {
      const g = multiplayerGames.find((x) => x.id === value);
      if (!g) return;
      activity = { kind: g.kind, gameId: g.id, difficulty: g.difficulties[0] };
    }
    const options = capacityOptions({ ...room, activity }, activity.kind === "watch" ? null : multiplayerGames.find((x) => x.id === value) ?? null);
    const capacity = options.includes(room.capacity) ? room.capacity : options[0];
    void run("activity", () => actions.updateSettings({ activity, capacity }));
  };

  const activityLabel = room.activity.kind === "watch" ? "Watch Together" : game?.title ?? "Unknown game";
  const ActivityIcon = room.activity.kind === "watch" ? Tv : KIND_META[room.activity.kind as Exclude<ActivityKind, "watch">].icon;

  return (
    <div className="flex flex-col gap-6">
      <Panel featured className="p-5 sm:p-7">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl border border-line-strong bg-white/[0.04] text-violet-300" aria-hidden="true">
            <ActivityIcon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.16em] text-fg-subtle">Up next</p>
            <h2 className="font-display text-2xl font-semibold tracking-tight">{activityLabel}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {room.activity.difficulty && <Badge tone="violet">{DIFFICULTY_LABEL[room.activity.difficulty]}</Badge>}
              <Badge tone={room.privacy === "private" ? "neutral" : "cyan"}>
                {room.privacy === "private" ? <Lock className="size-3" aria-hidden="true" /> : <Unlock className="size-3" aria-hidden="true" />}
                {room.privacy === "private" ? "Private" : "Open"}
              </Badge>
              <Badge>
                {room.participants.length}/{room.capacity} seats
              </Badge>
              {game?.turnMode && <Badge>{game.turnMode === "turns" ? "Take turns" : "Everyone answers"}</Badge>}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          {isHost ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                variant="primary"
                size="lg"
                icon={<Play className="size-4" />}
                disabled={blockers.length > 0 || !connected}
                loading={pending === "start"}
                onClick={() => void run("start", actions.start)}
              >
                {room.activity.kind === "watch" ? "Start watching" : "Start game"}
              </Button>
              <div className="text-sm text-fg-muted" aria-live="polite">
                {!connected ? "Waiting for connection…" : blockers.length > 0 ? blockers.join(" ") : "Everyone's ready."}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                variant={self?.ready ? "secondary" : "primary"}
                size="lg"
                aria-pressed={self?.ready ?? false}
                icon={self?.ready ? <Check className="size-4" /> : undefined}
                loading={pending === "ready"}
                disabled={!connected}
                onClick={() => void run("ready", () => actions.setReady(!self?.ready))}
              >
                {self?.ready ? "Ready — tap to undo" : "I'm ready"}
              </Button>
              <p className="text-sm text-fg-muted">The host starts when everyone is ready.</p>
            </div>
          )}
        </div>
      </Panel>

      <Panel className="p-5 sm:p-6">
        <InviteCode code={room.code} privacy={room.privacy} />
      </Panel>

      {isHost && (
        <Panel className="p-5 sm:p-6">
          <PanelHeader as="h2" title="Host controls" description="Changing the activity resets everyone's ready status." />
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Field label="Activity">
              {(p) => (
                <Select {...p} value={room.activity.kind === "watch" ? "watch" : room.activity.gameId} disabled={pending !== null || !connected} onChange={(e) => changeActivity(e.target.value)}>
                  {multiplayerGames.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                  {flags?.watchTogether && <option value="watch">Watch Together</option>}
                </Select>
              )}
            </Field>
            {game && game.difficulties.length > 1 && (
              <Segmented
                legend="Difficulty"
                name="room-difficulty"
                value={room.activity.difficulty ?? game.difficulties[0]}
                disabled={pending !== null || !connected}
                onChange={(difficulty: Difficulty) => void run("difficulty", () => actions.updateSettings({ activity: { ...room.activity, difficulty } }))}
                options={game.difficulties.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))}
              />
            )}
            <Segmented
              legend="Seats"
              name="room-capacity"
              value={room.capacity}
              disabled={pending !== null || !connected}
              onChange={(capacity: number) => void run("capacity", () => actions.updateSettings({ capacity }))}
              options={capacityOptions(room, game).map((n) => ({ value: n, label: String(n) }))}
            />
            <Segmented
              legend="Privacy"
              name="room-privacy"
              value={room.privacy}
              disabled={pending !== null || !connected}
              onChange={(privacy) => void run("privacy", () => actions.updateSettings({ privacy }))}
              options={[
                { value: "private", label: "Private (code only)" },
                { value: "open", label: "Open to matchmaking" },
              ]}
            />
          </div>
          {mockDev && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-warning/40 p-3">
              <Button
                size="sm"
                variant="outline"
                icon={<Bot className="size-4" />}
                disabled={room.participants.length >= room.capacity}
                onClick={() => {
                  try {
                    mockDev?.addBot(room.id);
                  } catch (e) {
                    toast.error("Couldn't add mock player", describeError(e));
                  }
                }}
              >
                Add mock player
              </Button>
              <p className="text-xs text-warning">Dev only: private mock rooms have no other people, so add labelled bots to test.</p>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
