"use client";

import { useSyncExternalStore } from "react";
import { api, mockDev } from "@/lib/api";
import { RealtimeConnection, type RealtimeStatus, type SocketLike } from "./connection";

export type { RealtimeStatus } from "./connection";
export { RealtimeError } from "./connection";
export * from "./events";

let connection: RealtimeConnection | null = null;

/** Lazily creates the app-wide realtime connection (one socket, many rooms). */
export function getRealtime(): RealtimeConnection {
  if (connection) return connection;
  connection = new RealtimeConnection(async (signal) => {
    const ticket = await api.realtime.ticket({ signal });
    if (mockDev) return mockDev.server.connect();
    return new WebSocket(ticket.url) as unknown as SocketLike;
  });
  if (typeof window !== "undefined") {
    const conn = connection;
    window.addEventListener("online", () => conn.retryNow());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && conn.status === "failed") conn.retryNow();
    });
  }
  return connection;
}

/** Drops the connection entirely, e.g. when the session ends. */
export function resetRealtime(): void {
  connection?.close();
  connection = null;
}

const noop = () => () => {};

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(
    typeof window === "undefined" ? noop : (cb) => getRealtime().onStatus(cb),
    () => (connection ? connection.status : "idle"),
    () => "idle",
  );
}
