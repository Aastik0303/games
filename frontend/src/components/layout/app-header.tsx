"use client";

import { Menu, X } from "lucide-react";
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
  { href: "/", label: "Home" },
  { href: "/solo", label: "Solo" },
  { href: "/play", label: "Find players" },
  { href: "/rooms/join", label: "Join room" },
  { href: "/watch", label: "Watch Together" },
];

export function AppHeader() {
  const pathname = usePathname();
  const { session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = session?.user.roles.includes("admin");

  // Close the mobile menu if this route gets hidden by Activity.
  useLayoutEffect(() => () => setMenuOpen(false), []);

  const links = isAdmin ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        {/* Floating feature bar, top right. */}
        <div className="glass ml-auto flex h-13 items-center gap-1 rounded-2xl px-1.5">
          <nav aria-label="Primary" className="hidden items-center gap-0.5 md:flex">
            {links.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm transition-colors",
                    active ? "bg-white/10 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]" : "text-fg-muted hover:bg-white/6 hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <span className="mx-1 hidden h-6 w-px bg-line-strong md:block" aria-hidden="true" />
          {status === "authenticated" && session ? (
            <Link
              href="/profile"
              className="hidden items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-fg-muted hover:bg-white/6 hover:text-fg sm:flex"
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
        <nav id="mobile-nav" aria-label="Primary" className="glass-strong mx-auto mt-2 max-w-7xl animate-fade-up rounded-2xl p-2 md:hidden">
          <ul className="flex flex-col gap-1">
            {[...links, { href: "/profile", label: session ? "Profile" : "Get started" }].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className="block rounded-xl px-3 py-2.5 text-fg-muted hover:bg-white/5 hover:text-fg aria-[current=page]:bg-white/8 aria-[current=page]:text-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          {IS_MOCK && <p className="mt-2 px-3 pb-1 text-xs text-warning">Mock data — not connected to a server.</p>}
        </nav>
      )}
    </header>
  );
}
