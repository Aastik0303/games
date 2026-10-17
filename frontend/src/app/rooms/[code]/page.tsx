import { Suspense } from "react";
import { PageContainer } from "@/components/layout/page-header";
import { FreshOnNavigate } from "@/components/layout/fresh-on-navigate";
import { RequireSession } from "@/components/layout/require-session";
import { RoomScreen } from "@/components/room/room-screen";
import { LoadingBlock, Skeleton } from "@/components/ui/states";

export default function RoomPage({ params }: PageProps<"/rooms/[code]">) {
  return (
    <PageContainer width="wide">
      <Suspense
        fallback={
          <LoadingBlock label="Loading room">
            <Skeleton className="h-[28rem]" />
          </LoadingBlock>
        }
      >
        <FreshOnNavigate>
          {params.then(({ code }) => (
            <RequireSession reason="You need a profile to join rooms." next={`/rooms/${code}`}>
              <RoomScreen code={code} />
            </RequireSession>
          ))}
        </FreshOnNavigate>
      </Suspense>
    </PageContainer>
  );
}
