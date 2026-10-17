"use client";

import { FlaskConical, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { IS_MOCK } from "@/lib/config";
import { cn } from "@/lib/cn";
import { useSession } from "@/components/providers/session-provider";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { SettingsPanel } from "./settings-panel";

const NAV = [
  { href: "/solo", label: "Solo" },
  { href: "/play", label: "Find players" },
  { href: "/rooms/join", label: "Join room" },
  { href: "/watch", label: "Watch Together" },
];

export function PrismMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="prism-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="0.55" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#f9a8d4" />
        </linearGradient>
      </defs>
      <path d="M16 3 29 27H3Z" fill="none" stroke="url(#prism-mark)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M16 3v24M9.5 15h13" stroke="url(#prism-mark)" strokeWidth="1.4" opacity="0.7" />
    </svg>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const { session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = session?.user.roles.includes("admin");

  // Close the mobile menu if this route gets hidden by Activity.
  useLayoutEffect(() => () => setMenuOpen(false), []);

  const links = isAdmin ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink-900/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-lg pr-2" aria-label="Prism home">
          <PrismMark className="size-7" />
          <span className="font-display text-lg font-semibold tracking-tight">Prism</span>
        </Link>
        {IS_MOCK && (
          <span
            className="hidden items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning sm:inline-flex"
            title="This build uses the in-browser mock adapter. Nothing is sent to a server."
          >
            <FlaskConical className="size-3" aria-hidden="true" /> Mock data
          </span>
        )}

        <nav aria-label="Primary" className="ml-4 hidden flex-1 items-center gap-1 md:flex">
          {links.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-white/8 text-fg" : "text-fg-muted hover:bg-white/5 hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {status === "authenticated" && session ? (
            <Link
              href="/profile"
              className="hidden items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-fg-muted hover:bg-white/5 hover:text-fg sm:flex"
            >
              <Avatar user={session.user} size="sm" />
              <span className="max-w-32 truncate">{session.user.displayName}</span>
            </Link>
          ) : status === "anonymous" || status === "expired" ? (
            <ButtonLink href="/profile" size="sm" variant="primary" className="hidden sm:inline-flex">
              Get started
            </ButtonLink>
          ) : null}
          <SettingsPanel />
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-xl text-fg-muted hover:bg-white/8 hover:text-fg md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-nav" aria-label="Primary" className="border-t border-line px-4 pb-4 pt-2 md:hidden">
          <ul className="flex flex-col gap-1">
            {[...links, { href: "/profile", label: session ? "Profile" : "Get started" }].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className="block rounded-lg px-3 py-2.5 text-fg-muted hover:bg-white/5 hover:text-fg aria-[current=page]:bg-white/8 aria-[current=page]:text-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          {IS_MOCK && <p className="mt-3 px-3 text-xs text-warning">Mock data — not connected to a server.</p>}
        </nav>
      )}
    </header>
  );
}
