"use client";

import { useEffect, type ReactNode } from "react";
import { applySettingsToDocument, useDeviceSettings } from "@/lib/settings";
import { ToastProvider } from "@/components/ui/toast";
import { FlagsProvider } from "./flags-provider";
import { SessionProvider } from "./session-provider";

function SettingsEffect() {
  const settings = useDeviceSettings();
  useEffect(() => applySettingsToDocument(settings), [settings]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider>
        <FlagsProvider>
          <SettingsEffect />
          {children}
        </FlagsProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
