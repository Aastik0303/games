import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { FreshOnNavigate } from "@/components/layout/fresh-on-navigate";
import { RequireSession } from "@/components/layout/require-session";
import { CreateRoomForm } from "@/components/room/create-room-form";
import { Skeleton } from "@/components/ui/states";

export const metadata: Metadata = { title: "Create a room" };

export default function CreateRoomPage() {
  return (
    <PageContainer>
      <PageHeader eyebrow="Rooms" title="Create a room" description="You'll be the host. Pick an activity and group size, then share the invite code." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <FreshOnNavigate withSearch>
          <RequireSession next="/rooms/new">
            <CreateRoomForm />
          </RequireSession>
        </FreshOnNavigate>
      </Suspense>
    </PageContainer>
  );
}
