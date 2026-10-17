"use client";

import { useSyncExternalStore } from "react";

/** Lets global UI (the settings panel) offer "Leave room" for the room currently on screen. */
export interface ActiveRoom {
  code: string;
  leave: () => Promise<void>;
}

let current: ActiveRoom | null = null;
const listeners = new Set<() => void>();

export function setActiveRoom(room: ActiveRoom | null): void {
  current = room;
  for (const l of listeners) l();
}

export function useActiveRoom(): ActiveRoom | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}
