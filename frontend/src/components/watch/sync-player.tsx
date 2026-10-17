"use client";

import { Captions, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { WatchState } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { getRealtime } from "@/lib/realtime";
import { useDeviceSettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { expectedPosition, formatTime, needsSeek } from "./sync";

/**
 * Synchronized <video>. Server state is authoritative: local transport
 * controls send commands and the element follows the broadcast state, so a
 * participant's player never "wins" a race with the host. Volume, captions
 * and fullscreen are local-only.
 */
export function SyncPlayer({
  state,
  canControl,
  onControl,
  stageRef,
}: {
  state: WatchState;
  canControl: boolean;
  onControl: (action: "play" | "pause" | "seek", positionSec: number) => Promise<unknown>;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const settings = useDeviceSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(settings.mediaVolume / 100);
  const [captions, setCaptions] = useState(settings.captionsByDefault);
  const [hasTracks, setHasTracks] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  const align = useCallback(() => {
    const v = videoRef.current;
    if (!v || !state.source) return;
    const target = expectedPosition(state, getRealtime().serverNow(), v.duration || undefined);
    if (needsSeek(v.currentTime, target)) v.currentTime = target;
    if (state.status === "playing" && v.paused) {
      v.play().then(
        () => setBlocked(false),
        () => setBlocked(true), // autoplay policy: needs a user gesture
      );
    } else if (state.status !== "playing" && !v.paused) {
      v.pause();
    }
  }, [state]);

  // Follow every new server state, then keep correcting drift while playing.
  useEffect(() => {
    align();
    if (state.status !== "playing") return;
    const id = setInterval(align, 2000);
    return () => clearInterval(id);
  }, [align, state.status]);

  // Pause when this view is hidden (route kept alive by Activity) or unmounted.
  useEffect(() => {
    const v = videoRef.current;
    return () => v?.pause();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    for (const track of Array.from(v.textTracks)) track.mode = captions ? "showing" : "hidden";
  }, [captions, hasTracks]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [stageRef]);

  async function control(action: "play" | "pause" | "seek", pos: number) {
    setPending(true);
    try {
      await onControl(action, pos);
    } finally {
      setPending(false);
    }
  }

  const playing = state.status === "playing";

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      <video
        ref={videoRef}
        key={state.source?.url}
        src={state.source?.url}
        className="min-h-0 w-full flex-1 object-contain"
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          setHasTracks(e.currentTarget.textTracks.length > 0);
          setError(null);
          align();
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onError={() => setError("This video can't be played here. The link may be broken, or the site doesn't allow playback in other apps.")}
        aria-label={state.source?.title ?? "Shared video"}
      />

      {error && (
        <div role="alert" className="absolute inset-0 flex items-center justify-center bg-ink-950/85 p-6 text-center text-sm text-fg">
          {error}
        </div>
      )}
      {blocked && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950/60">
          <Button
            variant="primary"
            size="lg"
            icon={<Play className="size-4" />}
            onClick={() => {
              videoRef.current?.play().then(() => setBlocked(false), () => setBlocked(true));
            }}
          >
            Join playback
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-ink-950/90 px-3 py-2 sm:gap-3">
        <Button
          size="icon"
          variant="ghost"
          disabled={!canControl || pending || !!error}
          aria-label={playing ? "Pause for everyone" : "Play for everyone"}
          title={canControl ? undefined : "Only the host controls playback"}
          onClick={() => {
            const pos = videoRef.current?.currentTime ?? state.positionSec;
            void control(playing ? "pause" : "play", pos);
          }}
        >
          {playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
        </Button>
        <span className="text-xs tabular-nums text-fg-muted">{formatTime(scrub ?? current)}</span>
        <label htmlFor="watch-seek" className="sr-only">
          Seek {canControl ? "" : "(host only)"}
        </label>
        <input
          id="watch-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={scrub ?? current}
          disabled={!canControl || !duration || !!error}
          aria-valuetext={`${formatTime(scrub ?? current)} of ${formatTime(duration)}`}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            if (scrub !== null) void control("seek", scrub).finally(() => setScrub(null));
          }}
          onKeyUp={(e) => {
            if (scrub !== null && (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")) void control("seek", scrub).finally(() => setScrub(null));
          }}
          className="min-w-24 flex-1 accent-violet-400 disabled:opacity-50"
        />
        <span className="text-xs tabular-nums text-fg-subtle">{formatTime(duration)}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
            {muted ? <VolumeX className="size-5" aria-hidden="true" /> : <Volume2 className="size-5" aria-hidden="true" />}
          </Button>
          <label htmlFor="watch-volume" className="sr-only">
            Volume
          </label>
          <input
            id="watch-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="hidden w-20 accent-violet-400 sm:block"
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label={hasTracks ? (captions ? "Hide captions" : "Show captions") : "No captions available for this video"}
            aria-pressed={captions}
            disabled={!hasTracks}
            className={cn(captions && hasTracks && "text-cyan-300")}
            onClick={() => setCaptions((c) => !c)}
          >
            <Captions className="size-5" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void stageRef.current?.requestFullscreen?.();
            }}
          >
            {fullscreen ? <Minimize className="size-5" aria-hidden="true" /> : <Maximize className="size-5" aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
