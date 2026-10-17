"use client";

import { Info, MonitorUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type ShareState = { status: "idle" } | { status: "requesting" } | { status: "sharing"; stream: MediaStream; label: string } | { status: "error"; message: string };

function supported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";
}

/**
 * Browser screen capture with explicit consent. The capture itself is real
 * (getDisplayMedia); relaying it to other participants needs the WebRTC/SFU
 * media layer, which this frontend doesn't include yet — so the UI says
 * plainly that it's a local preview.
 */
export function ScreenShare({ onSharingChange }: { onSharingChange?: (sharing: boolean) => void }) {
  const [explainOpen, setExplainOpen] = useState(false);
  const [share, setShare] = useState<ShareState>({ status: "idle" });
  const previewRef = useRef<HTMLVideoElement>(null);
  const stream = share.status === "sharing" ? share.stream : null;

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = stream;
    onSharingChange?.(stream !== null);
  }, [stream, onSharingChange]);

  // Always release capture when this view goes away.
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setShare({ status: "idle" });
  };

  async function start() {
    setExplainOpen(false);
    setShare({ status: "requesting" });
    try {
      const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = media.getVideoTracks();
      // The browser's own "Stop sharing" bar ends the track.
      track?.addEventListener("ended", () => setShare({ status: "idle" }));
      setShare({ status: "sharing", stream: media, label: track?.label || "Your screen" });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
      setShare(denied ? { status: "idle" } : { status: "error", message: "Screen sharing failed to start in this browser." });
    }
  }

  if (!supported()) {
    return <p className="text-xs text-fg-subtle">Screen sharing isn&apos;t available in this browser (most mobile browsers don&apos;t support it).</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {share.status === "sharing" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-danger/[0.06] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="relative flex size-2.5" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger/70" />
              <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
            </span>
            <p className="text-sm font-medium" role="status">
              You&apos;re capturing: {share.label}
            </p>
            <Button size="sm" variant="danger" className="ml-auto" icon={<Square className="size-3.5" />} onClick={stop}>
              Stop sharing
            </Button>
          </div>
          <video ref={previewRef} autoPlay muted playsInline className="aspect-video w-full rounded-xl bg-black object-contain" aria-label="Preview of your shared screen" />
          <p className="flex items-start gap-1.5 text-xs text-fg-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Local preview only. Sending your screen to others needs the Prism media server, which isn&apos;t connected in this build — nobody else can see this.
          </p>
        </div>
      ) : (
        <Button variant="outline" icon={<MonitorUp className="size-4" />} loading={share.status === "requesting"} onClick={() => setExplainOpen(true)}>
          Share screen (preview)
        </Button>
      )}
      {share.status === "error" && (
        <p role="alert" className="text-xs text-danger">
          {share.message}
        </p>
      )}

      <Dialog open={explainOpen} onOpenChange={setExplainOpen}>
        <DialogContent title="Before you share your screen" description="Your browser will ask what to share. Nothing is captured until you choose.">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-fg-muted">
            <li>You pick a tab, window or screen in your browser&apos;s own dialog — you can cancel there.</li>
            <li>Close anything private first: notifications and other tabs may be visible in what you share.</li>
            <li>Only share content you have the right to share. Protected streaming services usually show a black screen — that&apos;s expected.</li>
            <li>Stop at any time with the Stop button here or your browser&apos;s sharing bar.</li>
            <li className="text-warning">In this build the capture is a local preview; it isn&apos;t sent to other participants yet.</li>
          </ul>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setExplainOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void start()}>
              Choose what to share
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
