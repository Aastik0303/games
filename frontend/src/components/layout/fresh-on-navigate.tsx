"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, type ReactNode } from "react";

/**
 * With Cache Components, Next keeps recently visited routes alive (React
 * <Activity>), so forms would reopen with stale state — e.g. a "Creating…"
 * spinner. Keying on `bfcacheId` resets the subtree on fresh push/replace
 * navigations while still restoring it on browser back/forward.
 * Pass `withSearch` when the subtree's initial state comes from the query.
 */
export function FreshOnNavigate({ children, withSearch }: { children: ReactNode; withSearch?: boolean }) {
  const { bfcacheId } = useRouter();
  const search = useSearchParams();
  return <Fragment key={`${bfcacheId ?? ""}|${withSearch ? search.toString() : ""}`}>{children}</Fragment>;
}
