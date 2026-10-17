import { describe, expect, it, vi } from "vitest";
import { createHttpAdapter, httpRequest } from "./http";
import { sessionEvents } from "./session-events";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("http adapter", () => {
  it("sends credentials and the client header", async () => {
    const fetchImpl = vi.fn(async () => json(200, []));
    await createHttpAdapter(fetchImpl as unknown as typeof fetch).catalog.list();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/games$/);
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["X-Prism-Client"]).toBe("web");
  });

  it("treats 401 on session lookup as anonymous, not expiry", async () => {
    const listener = vi.fn();
    const off = sessionEvents.onExpired(listener);
    const api = createHttpAdapter((async () => json(401, {})) as unknown as typeof fetch);
    await expect(api.session.current()).resolves.toBeNull();
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("announces session expiry on 401 elsewhere", async () => {
    const listener = vi.fn();
    const off = sessionEvents.onExpired(listener);
    const api = createHttpAdapter((async () => json(401, { error: { code: "session_expired" } })) as unknown as typeof fetch);
    await expect(api.rooms.get("ABCD2345")).rejects.toMatchObject({ code: "session_expired" });
    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it("maps 429 with Retry-After and hides 5xx details", async () => {
    await expect(httpRequest("/x", {}, (async () => json(429, {}, { "Retry-After": "7" })) as unknown as typeof fetch)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSec: 7,
    });
    await expect(httpRequest("/x", {}, (async () => json(500, { error: { message: "stack trace!" } })) as unknown as typeof fetch)).rejects.toMatchObject({
      code: "server",
      message: "Server error",
    });
  });

  it("reports caller cancellation as aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const p = httpRequest("/slow", { signal: controller.signal }, fetchImpl as unknown as typeof fetch);
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: "aborted" });
  });
});
