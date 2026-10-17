"use client";

import type { DeviceSettings } from "./settings";

let ctx: AudioContext | null = null;

/** Short synthesized UI cues (no audio assets). Only plays when the user enabled UI sounds. */
export function playCue(kind: "match" | "turn" | "correct", settings: DeviceSettings): void {
  if (!settings.uiSounds || typeof window === "undefined" || !("AudioContext" in window)) return;
  try {
    ctx ??= new AudioContext();
    const notes = kind === "match" ? [523, 659, 784] : kind === "turn" ? [660, 880] : [784, 1046];
    const volume = Math.max(0.02, (settings.mediaVolume / 100) * 0.12);
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.09;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch {
    /* autoplay policy or unsupported — cues are optional */
  }
}

/** System notification only when enabled, permitted, and the tab is hidden. */
export function notify(title: string, body: string, settings: DeviceSettings): void {
  if (settings.notifications === "off" || typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted" || document.visibilityState === "visible") return;
  try {
    new Notification(title, { body, tag: "prism" });
  } catch {
    /* some platforms require a service worker for notifications */
  }
}
