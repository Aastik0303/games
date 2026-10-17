/**
 * The single entry point components use: `import { api } from "@/lib/api"`.
 *
 * The adapter is chosen from NEXT_PUBLIC_API_MODE (see config.ts). The mock
 * runtime is imported through the "prism-mock-runtime" alias, which
 * next.config.ts resolves to an empty stub for http builds — so fixtures and
 * the mock server are never part of a production bundle.
 */
import { createMockRuntime } from "prism-mock-runtime";
import { API_MODE } from "@/lib/config";
import type { PrismApi } from "./client";
import { createHttpAdapter } from "./http";
import type { MockServer } from "./mock/server";
import type { WatchSource } from "./types";

export type { PrismApi, RequestOptions } from "./client";
export * from "./errors";
export type * from "./types";

/** Dev-only controls available in mock mode; `null` when talking to a real backend. */
export interface MockDevControls {
  addBot(roomId: string): void;
  setAdmin(enabled: boolean): void;
  expireSession(): void;
  dropConnections(): void;
  /** A CC-licensed sample for trying Watch Together. */
  sampleWatchSource: WatchSource;
  server: MockServer;
}

function build(): { api: PrismApi; mockDev: MockDevControls | null } {
  if (API_MODE === "mock" && createMockRuntime) return createMockRuntime();
  return { api: createHttpAdapter(), mockDev: null };
}

const built = build();

export const api: PrismApi = built.api;
export const mockDev: MockDevControls | null = built.mockDev;
