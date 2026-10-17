import { ReportsQueue } from "@/components/admin/reports-queue";

// Admin content renders only after the client confirms an admin session, so it
// can never be part of the instant-navigation shell.
export const instant = false;

export default function AdminReportsPage() {
  return <ReportsQueue />;
}
