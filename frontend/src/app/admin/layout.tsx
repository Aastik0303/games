import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { PageContainer } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/states";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <AdminShell>{children}</AdminShell>
      </Suspense>
    </PageContainer>
  );
}
