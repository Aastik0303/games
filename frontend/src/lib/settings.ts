"use client";

import { useSyncExternalStore } from "react";

/**
 * Per-device UI preferences. Stored in localStorage because they are
 * conveniences for this browser only (motion, text size, volume) — account
 * data such as privacy settings goes through the API instead.
 */
export interface DeviceSettings {
  motion: "system" | "reduce" | "full";
  textSize: "default" | "large";
  contrast: "default" | "high";
  uiSounds: boolean;
  mediaVolume: number; // 0..100
  notifications: "off" | "turns_and_invites";
  captionsByDefault: boolean;
}

export const DEFAULT_SETTINGS: DeviceSettings = {
  motion: "system",
  textSize: "default",
  contrast: "default",
  uiSounds: false,
  mediaVolume: 80,
  notifications: "off",
  captionsByDefault: true,
};

const KEY = "prism.settings.v1";
const listeners = new Set<() => void>();
let cache: DeviceSettings | null = null;

function read(): DeviceSettings {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DeviceSettings>) } : DEFAULT_SETTINGS;
  } catch {
    cache = DEFAULT_SETTINGS;
  }
  return cache;
}

export function applySettingsToDocument(s: DeviceSettings): void {
  const root = document.documentElement;
  if (s.motion === "system") delete root.dataset.motion;
  else root.dataset.motion = s.motion;
  root.dataset.textSize = s.textSize;
  root.dataset.contrast = s.contrast;
}

export function updateSettings(patch: Partial<DeviceSettings>): void {
  cache = { ...read(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage blocked: settings last for this page view only */
  }
  applySettingsToDocument(cache);
  for (const l of listeners) l();
}

export function resetSettings(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  cache = DEFAULT_SETTINGS;
  applySettingsToDocument(cache);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useDeviceSettings(): DeviceSettings {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_SETTINGS);
}

/** Effective reduced-motion preference (in-app choice overrides the OS). */
export function prefersReducedMotion(s: DeviceSettings): boolean {
  if (s.motion === "reduce") return true;
  if (s.motion === "full") return false;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Inline script (runs before paint) so motion/text/contrast prefs don't flash. */
export const SETTINGS_BOOTSTRAP_SCRIPT = `try{var s=JSON.parse(localStorage.getItem("${KEY}")||"{}");var r=document.documentElement;if(s.motion&&s.motion!=="system")r.dataset.motion=s.motion;if(s.textSize)r.dataset.textSize=s.textSize;if(s.contrast)r.dataset.contrast=s.contrast;}catch(e){}`;
