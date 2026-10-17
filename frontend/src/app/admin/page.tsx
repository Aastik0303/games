import { AdminOverview } from "@/components/admin/admin-overview";

// Admin content renders only after the client confirms an admin session, so it
// can never be part of the instant-navigation shell.
export const instant = false;

export default function AdminOverviewPage() {
  return <AdminOverview />;
}
