import { FlagsPanel } from "@/components/admin/flags-panel";

// Admin content renders only after the client confirms an admin session, so it
// can never be part of the instant-navigation shell.
export const instant = false;

export default function AdminFlagsPage() {
  return <FlagsPanel />;
}
