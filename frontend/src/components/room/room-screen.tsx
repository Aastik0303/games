"use client";

import { DoorClosed, LogOut, MessageSquare, RefreshCw, Users, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError, isApiError } from "@/lib/api";
import type { Participant } from "@/lib/api/types";
import { IS_MOCK } from "@/lib/config";
import { cn } from "@/lib/cn";
import { getRealtime, useRealtimeStatus } from "@/lib/realtime";
import { formatRoomCode } from "@/lib/room-code";
import { useApiQuery } from "@/lib/use-api-query";
import { useFlags } from "@/components/providers/flags-provider";
import { useSession } from "@/components/providers/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, LoadingBlock, PermissionDenied, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { WatchStage } from "@/components/watch/watch-stage";
import { ChatPanel } from "./chat-panel";
import { LiveGame } from "./live-game";
import { Lobby } from "./lobby";
import { ModerationDialog, type ModerationTarget } from "./moderation-dialog";
import { ParticipantList } from "./participant-list";
import { ReactionBar, ReactionOverlay } from "./reactions";
import { realtimeErrorMessage, useRoom } from "./use-room";

const PHASE_LABEL = { lobby: "Lobby", playing: "Playing", watching: "Watching", closed: "Closed" } as const;

export function RoomScreen({ code }: { code: string }) {
  const { session } = useSession();
  const router = useRouter();
  const toast = useToast();
  const flags = useFlags();
  const { state, chat, actions } = useRoom(code);
  const rtStatus = useRealtimeStatus();
  const catalog = useApiQuery("catalog", (signal) => api.catalog.list({ signal }));
  const [modTarget, setModTarget] = useState<ModerationTarget | null>(null);
  const [kickTarget, setKickTarget] = useState<Participant | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [sideTab, setSideTab] = useState<"chat" | "people">("chat");
  const [mobilePanel, setMobilePanel] = useState<"chat" | "people" | null>(null);
  const selfId = session?.user.id ?? "";

  if (state.status === "joining") {
    return (
      <LoadingBlock label="Joining room">
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Skeleton className="h-[28rem]" />
          <Skeleton className="hidden h-[28rem] lg:block" />
        </div>
      </LoadingBlock>
    );
  }

  if (state.status === "error") {
    const err = state.error;
    if (isApiError(err) && err.code === "not_found") {
      return (
        <EmptyState
          title="Room not found"
          actions={
            <>
              <ButtonLink href="/rooms/join" variant="primary">
                Try another code
              </ButtonLink>
              <ButtonLink href="/rooms/new">Create a room</ButtonLink>
            </>
          }
        >
          No open room uses the code <span className="font-mono text-fg">{formatRoomCode(code)}</span>. It may have closed.
          {IS_MOCK && <span className="mt-2 block text-warning">Mock mode: rooms live in this tab&apos;s memory and reset when you reload.</span>}
        </EmptyState>
      );
    }
    if (isApiError(err) && err.code === "room_full") {
      return (
        <EmptyState title="This room is full" actions={<ButtonLink href="/play" variant="primary">Find other players</ButtonLink>}>
          Ask the host to add a seat, or find another group.
        </EmptyState>
      );
    }
    if (isApiError(err) && err.code === "forbidden") {
      return <PermissionDenied title="You can't join this room">The host or a moderator has restricted access.</PermissionDenied>;
    }
    return (
      <ErrorState actions={<Button variant="primary" onClick={actions.retryJoin}>Try again</Button>}>{describeError(err)}</ErrorState>
    );
  }

  if (state.status === "closed" || state.status === "removed") {
    return (
      <EmptyState
        icon={<DoorClosed className="size-6" />}
        title={state.status === "removed" ? "You were removed from this room" : "This room has closed"}
        actions={<ButtonLink href="/" variant="primary">Back home</ButtonLink>}
      >
        {state.status === "removed"
          ? "The host removed you. You can join other rooms any time."
          : state.closedReason === "host_left"
            ? "The host left, so the room was closed."
            : "The room is no longer available."}
      </EmptyState>
    );
  }

  const room = state.room!;
  const connected = rtStatus === "open" && !state.awaitingSnapshot;
  const isHost = room.hostId === selfId;
  const games = catalog.data ?? [];
  const chatEnabled = flags?.chat !== false;
  const nameFor = (id: string) => (id === selfId ? "You" : room.participants.find((p) => p.user.id === id)?.user.displayName ?? "Someone");

  const people = (
    <ParticipantList
      room={room}
      selfId={selfId}
      showReady={room.phase === "lobby"}
      scores={room.phase === "playing" ? state.game?.scores : undefined}
      onKick={room.phase === "lobby" ? setKickTarget : undefined}
      onModerate={setModTarget}
    />
  );
  const chatPanel = chatEnabled ? (
    <ChatPanel
      messages={chat}
      pending={state.pending}
      selfId={selfId}
      canSend={connected}
      disabledReason="Reconnecting…"
      onSend={(text) => void actions.sendChat(text)}
      onRetry={(id, text) => void actions.retryChat(id, text)}
      onDiscard={actions.discardChat}
      onModerate={setModTarget}
    />
  ) : (
    <p className="p-4 text-sm text-fg-muted">Chat is turned off right now.</p>
  );

  return (
    <div className="flex flex-col gap-4 pb-20 lg:pb-0">
      {/* Room bar */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight">
          Room <span className="font-mono tracking-[0.12em]">{formatRoomCode(room.code)}</span>
        </h1>
        <Badge tone={room.phase === "lobby" ? "neutral" : "success"}>{PHASE_LABEL[room.phase]}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<LogOut className="size-4" />} onClick={() => setConfirmLeave(true)}>
            Leave
          </Button>
        </div>
      </div>

      <ConnectionBanner status={rtStatus} awaitingSnapshot={state.awaitingSnapshot} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="relative min-w-0">
          {room.phase === "lobby" && <Lobby room={room} selfId={selfId} games={games} actions={actions} connected={connected} />}
          {room.phase === "playing" &&
            (state.game ? (
              <LiveGame room={room} game={state.game} selfId={selfId} actions={actions} connected={connected} />
            ) : (
              <Skeleton className="h-96" />
            ))}
          {room.phase === "watching" &&
            (state.watch ? (
              <WatchStage room={room} watch={state.watch} selfId={selfId} actions={actions} connected={connected} />
            ) : (
              <Skeleton className="aspect-video" />
            ))}

          {flags?.reactions !== false && room.phase !== "lobby" && (
            <>
              <ReactionOverlay reactions={state.reactions} nameFor={nameFor} onDone={actions.reactionDone} />
              <div className="mt-3 flex justify-center">
                <Panel className="px-2 py-1">
                  <ReactionBar
                    disabled={!connected}
                    onReact={(r) => void actions.react(r).catch((e) => toast.error("Reaction not sent", realtimeErrorMessage(e)))}
                  />
                </Panel>
              </div>
            </>
          )}
        </div>

        {/* Desktop side column */}
        <Panel as="aside" aria-label="Room people and chat" className="sticky top-20 hidden h-[calc(100dvh-7rem)] min-h-[28rem] flex-col overflow-hidden lg:flex">
          <div className="border-b border-line p-3">
            <Segmented
              legend="Side panel"
              hideLegend
              name="side-tab"
              value={sideTab}
              onChange={setSideTab}
              options={[
                { value: "chat", label: "Chat" },
                { value: "people", label: `People (${room.participants.length})` },
              ]}
            />
          </div>
          <div className={cn("min-h-0 flex-1", sideTab === "people" && "overflow-y-auto p-4")}>{sideTab === "chat" ? chatPanel : people}</div>
        </Panel>
      </div>

      {/* Mobile: keep the activity in focus; chat & people open as sheets */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-ink-900/90 p-3 backdrop-blur-xl lg:hidden">
        <Button className="flex-1" icon={<MessageSquare className="size-4" />} onClick={() => setMobilePanel("chat")}>
          Chat
        </Button>
        <Button className="flex-1" icon={<Users className="size-4" />} onClick={() => setMobilePanel("people")}>
          People ({room.participants.length})
        </Button>
      </div>
      <Dialog open={mobilePanel !== null} onOpenChange={(o) => !o && setMobilePanel(null)}>
        {mobilePanel && (
          <DialogContent side="right" title={mobilePanel === "chat" ? "Chat" : "People"} className="w-full">
            <div className={mobilePanel === "chat" ? "-mx-5 -my-4 flex h-[calc(100dvh-5.5rem)] flex-col" : ""}>{mobilePanel === "chat" ? chatPanel : people}</div>
          </DialogContent>
        )}
      </Dialog>

      <ModerationDialog target={modTarget} roomId={room.id} onClose={() => setModTarget(null)} onBlock={actions.block} />

      <Dialog open={kickTarget !== null} onOpenChange={(o) => !o && setKickTarget(null)}>
        {kickTarget && (
          <DialogContent title={`Remove ${kickTarget.user.displayName}?`} description="They'll be taken out of the room. They can rejoin with the code unless you make the room private and share a new one.">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setKickTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const target = kickTarget;
                  setKickTarget(null);
                  try {
                    await actions.kick(target.user.id);
                  } catch (e) {
                    toast.error("Couldn't remove player", realtimeErrorMessage(e));
                  }
                }}
              >
                Remove
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent title="Leave this room?" description={isHost ? "You're the host — leaving closes the room for everyone." : "You can rejoin later with the code if there's still a seat."}>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
              Stay
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmLeave(false);
                await actions.leave();
                router.push("/");
              }}
            >
              {isHost ? "Close room & leave" : "Leave"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectionBanner({ status, awaitingSnapshot }: { status: ReturnType<typeof useRealtimeStatus>; awaitingSnapshot: boolean }) {
  if (status === "open" && !awaitingSnapshot) return null;
  if (status === "failed") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-danger/35 bg-danger/10 px-4 py-3 text-sm">
        <WifiOff className="size-4 text-danger" aria-hidden="true" />
        <span className="flex-1">Connection lost. Your seat is held for a short while.</span>
        <Button size="sm" variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => getRealtime().retryNow()}>
          Reconnect
        </Button>
      </div>
    );
  }
  return (
    <div role="status" className="flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
      <RefreshCw className="size-4 animate-spin-slow" aria-hidden="true" />
      {status === "reconnecting" ? "Reconnecting… your place is saved." : "Connecting to the room…"}
    </div>
  );
}
