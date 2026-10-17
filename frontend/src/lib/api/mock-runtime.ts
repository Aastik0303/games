/**
 * ⚠️ DEV ONLY. Builds the in-browser mock backend. Imported through the
 * "prism-mock-runtime" alias, which next.config.ts points at
 * mock-runtime.disabled.ts for http-mode builds so no fixture ever ships.
 */
import type { PrismApi } from "./client";
import type { MockDevControls } from "./index";
import { createMockAdapter } from "./mock/adapter";
import { SAMPLE_WATCH_SOURCES } from "./mock/fixtures";
import { MockServer } from "./mock/server";

export function createMockRuntime(): { api: PrismApi; mockDev: MockDevControls } {
  const server = new MockServer();
  return {
    api: createMockAdapter(server),
    mockDev: {
      server,
      addBot: (roomId) => server.devAddBot(roomId),
      setAdmin: (enabled) => void server.devSetAdmin(enabled),
      expireSession: () => server.devExpireSession(),
      dropConnections: () => server.devDropConnections(),
      sampleWatchSource: SAMPLE_WATCH_SOURCES[0],
    },
  };
}
