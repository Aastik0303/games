import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { FreshOnNavigate } from "@/components/layout/fresh-on-navigate";
import { RequireSession } from "@/components/layout/require-session";
import { MatchmakingFlow } from "@/components/matchmaking/matchmaking-flow";
import { Skeleton } from "@/components/ui/states";

export const metadata: Metadata = { title: "Find players" };

export default function PlayPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Matchmaking"
        title="Find players"
        description="Pick the activity first. We match on what you want to play, language and group size — never on personal traits."
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <FreshOnNavigate withSearch>
          <RequireSession next="/play" reason="Matchmaking needs a profile so we can find people who speak your language.">
            <MatchmakingFlow />
          </RequireSession>
        </FreshOnNavigate>
      </Suspense>
    </PageContainer>
  );
}
