/**
 * ⚠️ MOCK ADAPTER — implements PrismApi against the in-browser MockServer with
 * simulated latency and real AbortSignal support. Selected only when
 * API_MODE === "mock" (see src/lib/config.ts).
 */
import type { PrismApi, RequestOptions } from "../client";
import { ApiError } from "../errors";
import { sessionEvents } from "../session-events";
import { MockServer } from "./server";

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ApiError("aborted", "Request cancelled"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError("aborted", "Request cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createMockAdapter(server: MockServer, latency: [number, number] = [120, 380]): PrismApi {
  /** Simulates a network round trip, then runs the handler (errors propagate like HTTP errors). */
  async function call<T>(opts: RequestOptions | undefined, fn: () => T): Promise<T> {
    await wait(latency[0] + Math.random() * (latency[1] - latency[0]), opts?.signal);
    try {
      return structuredClone(fn());
    } catch (error) {
      if (error instanceof ApiError && error.code === "session_expired") sessionEvents.emitExpired();
      throw error;
    }
  }

  return {
    mode: "mock",
    session: {
      current: (o) => call(o, () => server.currentSession()),
      create: (p, o) => call(o, () => server.createSession(p)),
      updateProfile: (p, o) => call(o, () => server.updateProfile(p)),
      refresh: (o) => call(o, () => server.refreshSession()),
      destroy: (o) => call(o, () => server.destroySession()),
    },
    privacy: {
      get: (o) => call(o, () => server.getPrivacy()),
      update: (s, o) => call(o, () => server.setPrivacy(s)),
    },
    config: { flags: (o) => call(o, () => server.featureFlags()) },
    community: { pulse: (o) => call(o, () => server.pulse()) },
    catalog: {
      list: (o) => call(o, () => server.listGames()),
      get: (id, o) => call(o, () => server.getGame(id)),
    },
    solo: {
      start: (g, d, o) => call(o, () => server.startSolo(g, d)),
      submit: (id, a, o) => call(o, () => server.submitSolo(id, a)),
      hint: (id, o) => call(o, () => server.soloHint(id)),
      inspectClue: (id, c, o) => call(o, () => server.inspectClue(id, c)),
      advance: (id, o) => call(o, () => server.advanceSolo(id)),
    },
    rooms: {
      create: (input, o) => call(o, () => server.createRoom(input)),
      get: (code, o) => call(o, () => server.getRoom(code)),
      join: (code, o) => call(o, () => server.joinRoom(code)),
      leave: (id, o) => call(o, () => server.leaveRoom(id)),
    },
    matchmaking: {
      enqueue: (c, o) => call(o, () => server.enqueue(c)),
      cancel: (id, o) => call(o, () => server.cancelTicket(id)),
    },
    realtime: {
      ticket: (o) => call(o, () => {
        if (!server.currentSession()) server.refreshSession(); // throws session_expired
        return { url: "mock://realtime", expiresAt: new Date(Date.now() + 60_000).toISOString() };
      }),
    },
    moderation: {
      report: (i, o) => call(o, () => server.report(i)),
      block: (id, o) => call(o, () => server.block(id)),
      unblock: (id, o) => call(o, () => server.unblock(id)),
      blocked: (o) => call(o, () => server.listBlocked()),
    },
    admin: {
      overview: (o) => call(o, () => server.adminOverview()),
      catalog: (o) => call(o, () => server.adminCatalog()),
      updateGame: (id, p, o) => call(o, () => server.adminUpdateGame(id, p)),
      reports: (s, o) => call(o, () => server.adminReports(s)),
      resolveReport: (id, a, n, o) => call(o, () => server.adminResolve(id, a, n)),
      flags: (o) => call(o, () => server.adminFlags()),
      setFlag: (k, e, o) => call(o, () => server.adminSetFlag(k, e)),
    },
  };
}
