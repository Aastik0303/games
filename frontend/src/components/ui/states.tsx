import { AlertTriangle, Lock, SearchX, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Panel } from "./panel";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse-soft rounded-xl bg-white/[0.06]", className)} />;
}

/** Screen-reader friendly wrapper for a block of skeletons. */
export function LoadingBlock({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

function StateShell({
  icon,
  title,
  children,
  actions,
  tone = "neutral",
  className,
  headingLevel: H = "h2",
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: "neutral" | "danger" | "warning";
  className?: string;
  headingLevel?: "h1" | "h2" | "h3";
}) {
  return (
    <Panel className={cn("mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-2xl border",
          tone === "danger" && "border-danger/30 bg-danger/10 text-danger",
          tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
          tone === "neutral" && "border-line-strong bg-white/5 text-violet-300",
        )}
        aria-hidden="true"
      >
        {icon}
      </div>
      <H className="font-display text-xl font-semibold tracking-tight">{title}</H>
      {children && <div className="text-sm text-fg-muted">{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </Panel>
  );
}

export function EmptyState(props: { title: ReactNode; children?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return <StateShell icon={props.icon ?? <SearchX className="size-6" />} {...props} />;
}

export function ErrorState(props: { title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string; headingLevel?: "h1" | "h2" }) {
  return (
    <div role="alert">
      <StateShell tone="danger" icon={<AlertTriangle className="size-6" />} {...props} title={props.title ?? "Something went wrong"} />
    </div>
  );
}

export function PermissionDenied(props: { title?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <StateShell tone="warning" icon={<Lock className="size-6" />} headingLevel="h1" {...props} title={props.title ?? "You don't have access"}>
      {props.children ?? "This area needs extra permissions. If you think that's a mistake, contact a Prism administrator."}
    </StateShell>
  );
}

export function OfflineState(props: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <StateShell tone="warning" icon={<WifiOff className="size-6" />} title="You're offline" {...props}>
      {props.children ?? "We'll reconnect automatically when your connection returns."}
    </StateShell>
  );
}
