"use client";

import { createContext, useContext, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { FeatureFlags } from "@/lib/api/types";
import { useApiQuery } from "@/lib/use-api-query";

/** `null` while loading or if the flags endpoint failed (features render as unavailable). */
const FlagsContext = createContext<FeatureFlags | null>(null);

export function FlagsProvider({ children }: { children: ReactNode }) {
  const { data } = useApiQuery("flags", (signal) => api.config.flags({ signal }), { refreshMs: 120_000 });
  return <FlagsContext.Provider value={data ?? null}>{children}</FlagsContext.Provider>;
}

export function useFlags(): FeatureFlags | null {
  return useContext(FlagsContext);
}
