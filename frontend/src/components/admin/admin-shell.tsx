"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { describeError, isApiError } from "@/lib/api";
import { IS_MOCK } from "@/lib/config";
import { cn } from "@/lib/cn";
import { RequireSession } from "@/components/layout/require-session";
import { useSession } from "@/components/providers/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, PermissionDenied } from "@/components/ui/states";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/reports", label: "Moderation" },
  { href: "/admin/catalog", label: "Game catalog" },
  { href: "/admin/flags", label: "Feature flags" },
];

function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("shrink-0 rounded-lg px-3 py-2 text-sm", active ? "bg-white/10 text-fg" : "text-fg-muted hover:bg-white/5 hover:text-fg")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Admin chrome. Hiding the UI for non-admins is a courtesy; every admin
 * endpoint is authorized by the backend and returns 403 otherwise.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <RequireSession next="/admin" reason="Sign in with an account that has admin access.">
      <AdminGate>{children}</AdminGate>
    </RequireSession>
  );
}

function AdminGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const roles = session?.user.roles ?? [];
  if (!roles.includes("admin") && !roles.includes("moderator")) {
    return (
      <PermissionDenied>
        The admin dashboard is only available to Prism staff.
        {IS_MOCK && <span className="mt-2 block text-warning">Mock mode: turn on “Mock admin role” in Settings → Developer to preview it.</span>}
      </PermissionDenied>
    );
  }
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ShieldCheck className="size-6 text-cyan-300" aria-hidden="true" />
        <h1 className="font-display text-2xl font-semibold tracking-tight">Operations</h1>
        {IS_MOCK && <Badge tone="warning">Fixture data</Badge>}
      </div>
      <AdminNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Uniform handling of 403 / errors for admin data views. */
export function AdminError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isApiError(error) && error.code === "forbidden") return <PermissionDenied>The server says your account can&apos;t view this section.</PermissionDenied>;
  return <ErrorState actions={<Button onClick={onRetry}>Retry</Button>}>{describeError(error)}</ErrorState>;
}
