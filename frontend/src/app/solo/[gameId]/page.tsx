import { Suspense } from "react";
import { SoloPlayer } from "@/components/games/solo-player";
import { PageContainer } from "@/components/layout/page-header";
import { FreshOnNavigate } from "@/components/layout/fresh-on-navigate";
import { RequireSession } from "@/components/layout/require-session";
import { LoadingBlock, Skeleton } from "@/components/ui/states";

export default function SoloGamePage({ params }: PageProps<"/solo/[gameId]">) {
  return (
    <PageContainer>
      <Suspense
        fallback={
          <LoadingBlock label="Loading game">
            <Skeleton className="h-96" />
          </LoadingBlock>
        }
      >
        <FreshOnNavigate>
          {params.then(({ gameId }) => (
            <RequireSession reason="Solo scores are saved to your profile." next={`/solo/${gameId}`}>
              <SoloPlayer gameId={gameId} />
            </RequireSession>
          ))}
        </FreshOnNavigate>
      </Suspense>
    </PageContainer>
  );
}
