"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, isAbort } from "@/lib/api";
import { sessionEvents } from "@/lib/api/session-events";
import type { Session } from "@/lib/api/types";
import { resetRealtime } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export type SessionStatus = "loading" | "anonymous" | "authenticated" | "expired" | "error";

interface SessionContextValue {
  status: SessionStatus;
  session: Session | null;
  setSession: (session: Session) => void;
  signOut: () => Promise<void>;
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Refresh this long before the server-declared expiry. */
const REFRESH_LEAD_MS = 2 * 60 * 1000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: SessionStatus; session: Session | null }>({ status: "loading", session: null });
  const [attempt, setAttempt] = useState(0);

  // Initial load (and manual retry after a network error).
  useEffect(() => {
    const controller = new AbortController();
    api.session.current({ signal: controller.signal }).then(
      (session) => setState({ status: session ? "authenticated" : "anonymous", session }),
      (error: unknown) => {
        if (!isAbort(error)) setState({ status: "error", session: null });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  // Any adapter can announce a 401; we drop local state and the socket.
  useEffect(
    () =>
      sessionEvents.onExpired(() => {
        resetRealtime();
        setState((prev) => (prev.session ? { status: "expired", session: null } : prev));
      }),
    [],
  );

  // Proactive refresh shortly before expiry.
  const expiresAt = state.session?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const delay = Math.max(5_000, Date.parse(expiresAt) - Date.now() - REFRESH_LEAD_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.session.refresh({ signal: controller.signal }).then(
        (session) => setState({ status: "authenticated", session }),
        (error: unknown) => {
          if (!isAbort(error)) setState({ status: "expired", session: null });
        },
      );
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [expiresAt]);

  const setSession = useCallback((session: Session) => setState({ status: "authenticated", session }), []);

  const signOut = useCallback(async () => {
    try {
      await api.session.destroy();
    } finally {
      resetRealtime();
      setState({ status: "anonymous", session: null });
    }
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading", session: null });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ status: state.status, session: state.session, setSession, signOut, retry }),
    [state, setSession, signOut, retry],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      <Dialog
        open={state.status === "expired"}
        onOpenChange={(open) => {
          if (!open) setState({ status: "anonymous", session: null });
        }}
      >
        <DialogContent
          title="Your session ended"
          description="For your security, sessions expire after a period of time. Your device settings are kept."
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setState({ status: "anonymous", session: null })}>
              Not now
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setState({ status: "anonymous", session: null });
                router.push("/profile");
              }}
            >
              Set up again
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
