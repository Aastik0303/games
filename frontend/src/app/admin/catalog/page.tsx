import { CatalogManager } from "@/components/admin/catalog-manager";

// Admin content renders only after the client confirms an admin session, so it
// can never be part of the instant-navigation shell.
export const instant = false;

export default function AdminCatalogPage() {
  return <CatalogManager />;
}
