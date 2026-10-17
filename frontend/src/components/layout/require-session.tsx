"use client";

import { UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useSession } from "@/components/providers/session-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from "@/components/ui/states";

/**
 * Client-side gate for routes that need a profile. This is UX only — the
 * backend independently rejects unauthenticated calls.
 */
export function RequireSession({ children, reason, next }: { children: ReactNode; reason?: string; next?: string }) {
  const { status, retry } = useSession();

  if (status === "loading") {
    return (
      <LoadingBlock label="Checking your session">
        <Skeleton className="mx-auto h-64 max-w-3xl" />
      </LoadingBlock>
    );
  }
  if (status === "error") {
    return (
      <ErrorState
        title="Can't reach Prism"
        actions={
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
        }
      >
        We couldn&apos;t check your session. Your connection or our servers may be having trouble.
      </ErrorState>
    );
  }
  if (status !== "authenticated") {
    return (
      <EmptyState
        icon={<UserRound className="size-6" />}
        title="Set up your profile first"
        actions={
          <ButtonLink variant="primary" href={next ? `/profile?next=${encodeURIComponent(next)}` : "/profile"}>
            Create profile
          </ButtonLink>
        }
      >
        {reason ?? "Prism needs a display name and a few preferences before you can play with others."} It takes under a minute.
      </EmptyState>
    );
  }
  return <>{children}</>;
}
