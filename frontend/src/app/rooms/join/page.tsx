import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { FreshOnNavigate } from "@/components/layout/fresh-on-navigate";
import { JoinRoomForm } from "@/components/room/join-room-form";

export const metadata: Metadata = { title: "Join a room" };

export default function JoinRoomPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader eyebrow="Rooms" title="Join with a code" description="Enter the code your host shared. You'll see the lobby before anything starts." />
      <Suspense>
        <FreshOnNavigate>
          <JoinRoomForm />
        </FreshOnNavigate>
      </Suspense>
    </PageContainer>
  );
}
