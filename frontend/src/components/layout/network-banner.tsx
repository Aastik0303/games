"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** App-wide offline banner. Room-level reconnect state is shown by the room itself. */
export function NetworkBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
      <WifiOff className="mr-2 inline size-4 align-[-3px]" aria-hidden="true" />
      You&apos;re offline. We&apos;ll reconnect automatically when your connection is back.
    </div>
  );
}
