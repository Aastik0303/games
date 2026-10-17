import { ArrowRight, DoorOpen, Hash, Puzzle, ShieldCheck, Tv, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CommunityPulse } from "@/components/home/community-pulse";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface ModeCard {
  href: string;
  title: string;
  body: string;
  icon: ReactNode;
  accent: string;
  featured?: boolean;
}

const MODES: ModeCard[] = [
  { href: "/solo", title: "Solo play", body: "Word gaps, riddles, logic grids and a murder-mystery case. Play at your own pace.", icon: <Puzzle />, accent: "text-violet-300", featured: true },
  { href: "/play", title: "Find players", body: "Pick an activity first, then we'll match you with 2–4 people who want the same thing.", icon: <Users />, accent: "text-cyan-300" },
  { href: "/rooms/new", title: "Create a room", body: "Choose the game and the group size. Share a short code with the people you invite.", icon: <DoorOpen />, accent: "text-magenta-300" },
  { href: "/rooms/join", title: "Join with a code", body: "Got an 8-character invite code? Jump straight into the lobby.", icon: <Hash />, accent: "text-violet-300" },
  { href: "/watch", title: "Watch together", body: "Synced playback of videos you're allowed to share, with the picture front and centre.", icon: <Tv />, accent: "text-cyan-300" },
];

/** Decorative refracting prism for the featured card (hidden from assistive tech). */
function PrismArt() {
  return (
    <svg viewBox="0 0 200 160" aria-hidden="true" className="pointer-events-none mb-auto hidden w-full max-w-64 self-center opacity-80 lg:block">
      <defs>
        <linearGradient id="beam" x1="0" x2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="0.5" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#f9a8d4" />
        </linearGradient>
      </defs>
      <path d="M0 92 L84 80" stroke="#f1f2fa" strokeOpacity="0.5" strokeWidth="2" />
      <path d="M100 20 L150 120 H50 Z" fill="rgb(255 255 255 / 0.04)" stroke="url(#beam)" strokeWidth="2" strokeLinejoin="round" />
      {["#c4b5fd", "#a78bfa", "#67e8f9", "#f9a8d4"].map((c, i) => (
        <path key={c} d={`M118 ${82 + i * 3} L200 ${70 + i * 16}`} stroke={c} strokeWidth="2.5" strokeOpacity="0.85" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
      <section className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]" aria-labelledby="hero-title">
        <div className="animate-fade-up">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1 text-xs text-fg-muted">
            <span className="prism-bar size-1.5 rounded-full" aria-hidden="true" /> Puzzles · Rooms · Watch Together
          </p>
          <h1 id="hero-title" className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-6xl">
            Play puzzles <span className="prism-text">together</span>,<br className="hidden sm:block" /> with people who like what you like.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-fg-muted text-pretty">
            Prism matches you by activity, language and shared interests — never by who you are. Solve solo, team up, or open a room for friends.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/play" variant="primary" size="lg">
              Find players <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/solo" variant="secondary" size="lg">
              Play solo
            </ButtonLink>
          </div>
        </div>
        <CommunityPulse />
      </section>

      <section aria-labelledby="modes-title" className="mt-16">
        <h2 id="modes-title" className="sr-only">
          Ways to play
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODES.map((mode, i) => (
            <li key={mode.href} className={cn(i === 0 && "lg:row-span-2")}>
              <Link
                href={mode.href}
                className={cn(
                  "glass group flex h-full flex-col rounded-[var(--radius-panel)] p-6 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-glow)]",
                  mode.featured && "prism-edge lg:justify-end lg:p-8",
                )}
              >
                {mode.featured && <PrismArt />}
                <span className={cn("flex size-11 items-center justify-center rounded-2xl border border-line-strong bg-white/[0.04] [&_svg]:size-5", mode.accent)} aria-hidden="true">
                  {mode.icon}
                </span>
                <span className={cn("mt-5 font-display font-semibold tracking-tight", mode.featured ? "text-2xl" : "text-lg")}>{mode.title}</span>
                <span className="mt-2 text-sm text-fg-muted">{mode.body}</span>
                <span className="mt-5 inline-flex items-center gap-1 text-sm text-fg-subtle transition-colors group-hover:text-fg">
                  Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="safety-title" className="glass mt-16 grid gap-6 rounded-[var(--radius-panel)] p-6 sm:p-8 md:grid-cols-[auto_1fr] md:items-center">
        <span className="flex size-12 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300" aria-hidden="true">
          <ShieldCheck className="size-6" />
        </span>
        <div>
          <h2 id="safety-title" className="font-display text-xl font-semibold tracking-tight">Safe by default</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            We ask for an age band, not a birthday, and never for gender. Players under 18 get stricter chat filtering and are only matched within
            their age group. Report or block anyone from chat in one tap — reports go to human moderators.{" "}
            <Link href="/guidelines" className="text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white">
              Read the guidelines
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
