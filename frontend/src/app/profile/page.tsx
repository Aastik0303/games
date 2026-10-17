import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/layout/page-header";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { Skeleton } from "@/components/ui/states";

export const metadata: Metadata = { title: "Your profile" };

export default function ProfilePage() {
  return (
    <PageContainer width="narrow">
      <Suspense fallback={<Skeleton className="h-[40rem]" />}>
        <ProfileScreen />
      </Suspense>
    </PageContainer>
  );
}
