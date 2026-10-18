import { ArrowDown, ArrowRight, DoorOpen, Hash, Puzzle, ShieldCheck, Tv, UserRound, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { LiquidCard, LiquidCardLink } from "@/components/ui/liquid-card";
import { cn } from "@/lib/cn";

const MORE_LINKS = [
  { href: "/watch", label: "Watch Together", icon: Tv },
  { href: "/rooms/join", label: "Join with code", icon: Hash },
  { href: "/profile", label: "Your profile", icon: UserRound },
  { href: "/guidelines", label: "Guidelines", icon: ShieldCheck },
];

function CardIcon({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={cn("flex size-12 items-center justify-center rounded-2xl border border-line-strong bg-white/[0.05] [&_svg]:size-6", className)}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function OpenHint() {
  return (
    <span className="mt-auto inline-flex items-center gap-1 pt-6 text-sm text-fg-subtle transition-colors group-hover:text-fg">
      Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
    </span>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
      {/* First screen: the three ways in. */}
      <section aria-labelledby="hero-title" className="flex min-h-[calc(100dvh-5.5rem)] flex-col pb-8 pt-10 sm:pt-20">
        {/* Visually hidden: the page still needs a top-level heading for screen readers. */}
        <h1 id="hero-title" className="sr-only">
          Prism: play puzzles together
        </h1>

        <ul className="grid flex-1 content-start gap-5 md:grid-cols-2 lg:mt-14 lg:grid-cols-[1fr_1fr_1.25fr] lg:gap-8">
          <li className="float">
            <LiquidCardLink href="/solo" className="group flex h-full min-h-56 flex-col p-6 sm:p-7">
              <CardIcon className="text-violet-300">
                <Puzzle />
              </CardIcon>
              <span className="mt-6 font-display text-2xl font-semibold tracking-tight">Single play</span>
              <span className="mt-2 text-sm text-fg-muted">Word gaps, riddles, logic grids and a mystery case. Your pace.</span>
              <OpenHint />
            </LiquidCardLink>
          </li>

          <li className="float">
            <LiquidCardLink href="/play" className="group flex h-full min-h-56 flex-col p-6 sm:p-7">
              <CardIcon className="text-cyan-300">
                <Users />
              </CardIcon>
              <span className="mt-6 font-display text-2xl font-semibold tracking-tight">Multiplayer</span>
              <span className="mt-2 text-sm text-fg-muted">Pick a game and get matched with 2–4 players who want the same.</span>
              <OpenHint />
            </LiquidCardLink>
          </li>

          <li className="float md:col-span-2 lg:col-span-1">
            <LiquidCard className="flex h-full min-h-56 flex-col p-6 sm:p-7">
              <CardIcon className="text-magenta-300">
                <DoorOpen />
              </CardIcon>
              <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">Room</h2>
              <p className="mt-2 text-sm text-fg-muted">A private room for your group: live games, chat and watch parties.</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-6">
                <ButtonLink href="/rooms/new" variant="primary" icon={<DoorOpen className="size-4" aria-hidden="true" />}>
                  Create room
                </ButtonLink>
                <ButtonLink href="/rooms/join" icon={<Hash className="size-4" aria-hidden="true" />}>
                  Join with code
                </ButtonLink>
              </div>
            </LiquidCard>
          </li>
        </ul>

        <a
          href="#more"
          className="group mt-10 inline-flex w-fit items-center gap-2 rounded-full px-1 py-1 text-sm text-fg-subtle transition-colors hover:text-fg"
        >
          <span className="flex size-9 items-center justify-center rounded-full border border-line-strong bg-white/[0.04]">
            <ArrowDown className="size-4 animate-bounce" aria-hidden="true" />
          </span>
          Scroll for more
        </a>
      </section>

      {/* Below the fold: everything else. */}
      <section id="more" aria-labelledby="more-title" className="scroll-mt-24 pb-20 pt-6">
        <div className="reveal glass flex flex-wrap items-center gap-x-2 gap-y-2 rounded-2xl p-2 pl-5">
          <h2 id="more-title" className="mr-3 font-display text-sm font-semibold uppercase tracking-[0.16em] text-fg-subtle">
            Other features
          </h2>
          <nav aria-label="Other features" className="flex flex-wrap gap-1">
            {MORE_LINKS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-white/8 hover:text-fg">
                <Icon className="size-4" aria-hidden="true" /> {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2 lg:gap-8">
          <div className="float">
            <div className="reveal h-full">
              <LiquidCardLink href="/watch" className="group flex h-full flex-col p-6 sm:p-7">
                <CardIcon className="text-cyan-300">
                  <Tv />
                </CardIcon>
                <span className="mt-6 font-display text-xl font-semibold tracking-tight">Watch Together</span>
                <span className="mt-2 text-sm text-fg-muted">Synced playback of videos you&apos;re allowed to share, picture front and centre.</span>
                <OpenHint />
              </LiquidCardLink>
            </div>
          </div>

          <div className="float">
            <div className="reveal h-full">
              <LiquidCard className="flex h-full flex-col p-6 sm:p-7">
                <CardIcon className="text-violet-300">
                  <ShieldCheck />
                </CardIcon>
                <h3 className="mt-6 font-display text-xl font-semibold tracking-tight">Safe by default</h3>
                <p className="mt-2 text-sm text-fg-muted">
                  An age band, never a birthday or gender. Under-18s get stricter filtering and age-matched games. Report or block from chat in one tap.
                </p>
                <Link href="/guidelines" className="mt-auto pt-6 text-sm text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white">
                  Read the guidelines
                </Link>
              </LiquidCard>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
