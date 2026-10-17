"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Hook point for an error reporter (Sentry etc.). Never render raw messages.
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <div className="px-4 py-16">
      <ErrorState
        headingLevel="h1"
        actions={
          <>
            <Button variant="primary" onClick={() => retry()}>
              Try again
            </Button>
            <ButtonLink href="/" variant="ghost">
              Go home
            </ButtonLink>
          </>
        }
      >
        This part of Prism hit an unexpected problem. Trying again usually helps.
        {digest && <span className="mt-2 block font-mono text-xs text-fg-subtle">Reference: {digest}</span>}
      </ErrorState>
    </div>
  );
}
