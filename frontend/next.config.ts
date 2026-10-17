import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Screen capture is allowed only for this origin; camera/mic/geolocation are not used.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), display-capture=(self)" },
];

/** Mirrors src/lib/config.ts: decides whether the mock runtime is bundled at all. */
function mockEnabled(phase: string): boolean {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const mode = process.env.NEXT_PUBLIC_API_MODE;
  if (mode === "http") return false;
  if (mode === "mock") return dev || process.env.NEXT_PUBLIC_ALLOW_MOCK_IN_PRODUCTION === "true";
  return dev;
}

export default function config(phase: string): NextConfig {
  const mockRuntime = mockEnabled(phase) ? "./src/lib/api/mock-runtime.ts" : "./src/lib/api/mock-runtime.disabled.ts";
  return {
    cacheComponents: true,
    partialPrefetching: true,
    poweredByHeader: false,
    turbopack: {
      // The repo lives inside a home directory that has its own lockfile.
      root: path.resolve("."),
      resolveAlias: { "prism-mock-runtime": mockRuntime },
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  };
}
