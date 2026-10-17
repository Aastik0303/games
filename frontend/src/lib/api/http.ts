import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "@/lib/config";
import type { PrismApi, RequestOptions } from "./client";
import { ApiError, type ApiErrorCode } from "./errors";
import { sessionEvents } from "./session-events";
import type { Session } from "./types";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface HttpRequest extends RequestOptions {
  method?: Method;
  body?: unknown;
  /** When true a 401 resolves to `null` instead of signalling session expiry. */
  allowAnonymous?: boolean;
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: "validation",
  401: "session_expired",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
  429: "rate_limited",
};

const KNOWN_CODES = new Set<ApiErrorCode>([
  "unauthorized", "session_expired", "forbidden", "not_found", "validation",
  "rate_limited", "room_full", "conflict", "server",
]);

/**
 * Merges the caller's signal with a request timeout. Returns a cleanup
 * function so timers never outlive the request.
 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export async function httpRequest<T>(
  path: string,
  { method = "GET", body, signal, allowAnonymous }: HttpRequest = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const timeout = withTimeout(signal, REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE_URL}${path}`, {
      method,
      // Session lives in an HttpOnly cookie set by the backend; the browser
      // never handles the token directly.
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        // Lets the backend reject cross-site form posts (CSRF defence in depth
        // alongside SameSite cookies and Origin checks).
        "X-Prism-Client": "web",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: timeout.signal,
    });
  } catch (error) {
    if (timeout.timedOut()) throw new ApiError("timeout", "Request timed out");
    if (signal?.aborted) throw new ApiError("aborted", "Request cancelled");
    throw new ApiError("network", error instanceof Error ? error.message : "Network error");
  } finally {
    timeout.cleanup();
  }

  if (response.status === 401 && allowAnonymous) return null as T;
  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    let parsed: ErrorBody = {};
    try {
      parsed = (await response.json()) as ErrorBody;
    } catch {
      /* non-JSON error body */
    }
    const bodyCode = parsed.error?.code as ApiErrorCode | undefined;
    const code: ApiErrorCode =
      bodyCode && KNOWN_CODES.has(bodyCode) ? bodyCode : STATUS_CODES[response.status] ?? "server";
    const retryAfter = Number(response.headers.get("Retry-After"));
    if (code === "session_expired" || code === "unauthorized") sessionEvents.emitExpired();
    throw new ApiError(code, response.status >= 500 ? "Server error" : parsed.error?.message ?? response.statusText, {
      status: response.status,
      retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      fieldErrors: parsed.error?.fields,
    });
  }

  return (await response.json()) as T;
}

const enc = encodeURIComponent;

export function createHttpAdapter(fetchImpl: typeof fetch = (...args) => fetch(...args)): PrismApi {
  const req = <T>(path: string, init?: HttpRequest) => httpRequest<T>(path, init, fetchImpl);

  return {
    mode: "http",
    session: {
      current: (o) => req<Session | null>("/v1/session", { ...o, allowAnonymous: true }),
      create: (profile, o) => req("/v1/session", { ...o, method: "POST", body: { profile } }),
      updateProfile: (profile, o) => req("/v1/session/profile", { ...o, method: "PUT", body: { profile } }),
      refresh: (o) => req("/v1/session/refresh", { ...o, method: "POST" }),
      destroy: (o) => req("/v1/session", { ...o, method: "DELETE" }),
    },
    privacy: {
      get: (o) => req("/v1/me/privacy", o),
      update: (settings, o) => req("/v1/me/privacy", { ...o, method: "PUT", body: settings }),
    },
    config: {
      flags: (o) => req("/v1/config/flags", o),
    },
    community: {
      pulse: (o) => req("/v1/community/pulse", o),
    },
    catalog: {
      list: (o) => req("/v1/games", o),
      get: (id, o) => req(`/v1/games/${enc(id)}`, o),
    },
    solo: {
      start: (gameId, difficulty, o) => req("/v1/solo/sessions", { ...o, method: "POST", body: { gameId, difficulty } }),
      submit: (id, answer, o) => req(`/v1/solo/sessions/${enc(id)}/answers`, { ...o, method: "POST", body: { answer } }),
      hint: (id, o) => req(`/v1/solo/sessions/${enc(id)}/hints`, { ...o, method: "POST" }),
      inspectClue: (id, clueId, o) => req(`/v1/solo/sessions/${enc(id)}/clues/${enc(clueId)}`, { ...o, method: "POST" }),
      advance: (id, o) => req(`/v1/solo/sessions/${enc(id)}/advance`, { ...o, method: "POST" }),
    },
    rooms: {
      create: (input, o) => req("/v1/rooms", { ...o, method: "POST", body: input }),
      get: (code, o) => req(`/v1/rooms/${enc(code)}`, o),
      join: (code, o) => req(`/v1/rooms/${enc(code)}/join`, { ...o, method: "POST" }),
      leave: (roomId, o) => req(`/v1/rooms/by-id/${enc(roomId)}/leave`, { ...o, method: "POST" }),
    },
    matchmaking: {
      enqueue: (criteria, o) => req("/v1/matchmaking/tickets", { ...o, method: "POST", body: criteria }),
      cancel: (ticketId, o) => req(`/v1/matchmaking/tickets/${enc(ticketId)}`, { ...o, method: "DELETE" }),
    },
    realtime: {
      ticket: (o) => req("/v1/realtime/tickets", { ...o, method: "POST" }),
    },
    moderation: {
      report: (input, o) => req("/v1/reports", { ...o, method: "POST", body: input }),
      block: (userId, o) => req(`/v1/blocks/${enc(userId)}`, { ...o, method: "PUT" }),
      unblock: (userId, o) => req(`/v1/blocks/${enc(userId)}`, { ...o, method: "DELETE" }),
      blocked: (o) => req("/v1/blocks", o),
    },
    admin: {
      overview: (o) => req("/v1/admin/overview", o),
      catalog: (o) => req("/v1/admin/games", o),
      updateGame: (id, patch, o) => req(`/v1/admin/games/${enc(id)}`, { ...o, method: "PATCH", body: patch }),
      reports: (status, o) => req(`/v1/admin/reports?status=${enc(status)}`, o),
      resolveReport: (id, action, note, o) =>
        req(`/v1/admin/reports/${enc(id)}/resolution`, { ...o, method: "POST", body: { action, note } }),
      flags: (o) => req("/v1/admin/flags", o),
      setFlag: (key, enabled, o) => req(`/v1/admin/flags/${enc(key)}`, { ...o, method: "PUT", body: { enabled } }),
    },
  };
}
