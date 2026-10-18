import { Captions, Hash, MonitorUp, RefreshCw, ShieldAlert, Tv } from "lucide-react";
import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/ui/button";
import { LiquidCard } from "@/components/ui/liquid-card";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Watch Together" };

const POINTS = [
  { icon: RefreshCw, title: "Truly in sync", body: "The host's play, pause and seek are applied for everyone, with automatic drift correction." },
  { icon: Captions, title: "Your view, your settings", body: "Volume, captions and full screen stay personal." },
  { icon: MonitorUp, title: "Screen share (preview)", body: "Uses your browser's own share picker with explicit permission. Sending to others needs the media server — see the note in the room." },
];

export default function WatchPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Watch Together"
        title="Watch together, picture first"
        description="Open a room, load a video you're allowed to share, and everyone stays on the same frame."
        actions={
          <>
            <ButtonLink href="/rooms/new?activity=watch" variant="primary" size="lg" icon={<Tv className="size-4" />}>
              Start a watch room
            </ButtonLink>
            <ButtonLink href="/rooms/join" size="lg" icon={<Hash className="size-4" />}>
              Join with code
            </ButtonLink>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        {POINTS.map((p) => (
          <LiquidCard key={p.title} className="float p-6">
            <p.icon className="size-6 text-cyan-300" aria-hidden="true" />
            <h2 className="mt-4 font-display text-lg font-semibold">{p.title}</h2>
            <p className="mt-1.5 text-sm text-fg-muted">{p.body}</p>
          </LiquidCard>
        ))}
      </div>
      <Panel className="mt-6 flex gap-4 p-6">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="text-sm text-fg-muted">
          <h2 className="font-semibold text-fg">What can be played</h2>
          <p className="mt-1">
            Direct links to video files you have the right to share (your own uploads, Creative Commons or public-domain films). Paid streaming services
            protect their content with DRM — Prism doesn&apos;t try to get around that, and those services usually appear black if screen-shared. Results
            vary by browser.
          </p>
        </div>
      </Panel>
    </PageContainer>
  );
}
