/**
 * Environment-derived runtime configuration.
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js can inline
 * the values at build time. Nothing secret belongs here: every NEXT_PUBLIC_
 * value ships to the browser.
 */

export type ApiMode = "mock" | "http";

const isProduction = process.env.NODE_ENV === "production";
const requestedMode = process.env.NEXT_PUBLIC_API_MODE;
const allowMockInProduction = process.env.NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION === "true";

function resolveMode(): ApiMode {
  if (requestedMode === "http") return "http";
  if (requestedMode === "mock") {
    // Guard against shipping fixtures by accident: a production build only uses
    // the mock adapter when explicitly allowed (e.g. a design-review preview).
    return !isProduction || allowMockInProduction ? "mock" : "http";
  }
  return isProduction ? "http" : "mock";
}

export const API_MODE: ApiMode = resolveMode();
export const IS_MOCK = API_MODE === "mock";

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

/** WebSocket base; defaults to the API origin with ws(s):// */
export const WS_BASE_URL = (
  process.env.NEXT_PUBLIC_WS_BASE_URL ?? API_BASE_URL.replace(/^http/, "ws")
).replace(/\/$/, "");

export const REQUEST_TIMEOUT_MS = 15_000;
