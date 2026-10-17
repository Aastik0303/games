"use client";

import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

/**
 * Accessible modal (focus trap, Escape, aria-modal via Radix).
 * `side="right"` renders a full-height sheet, used for the settings panel.
 */
export function DialogContent({
  title,
  description,
  children,
  side = "center",
  className,
  hideClose,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  side?: "center" | "right";
  className?: string;
  hideClose?: boolean;
}) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm data-[state=open]:animate-fade-up" />
      <RD.Content
        className={cn(
          "glass-strong fixed z-50 flex flex-col text-fg outline-none",
          side === "center" &&
            "left-1/2 top-1/2 max-h-[min(90dvh,44rem)] w-[min(calc(100vw-2rem),32rem)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-panel)] data-[state=open]:animate-fade-up",
          side === "right" &&
            "inset-y-0 right-0 w-[min(100vw,26rem)] rounded-l-[var(--radius-panel)] border-r-0 bg-ink-850! data-[state=open]:animate-fade-up",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <RD.Title className="font-display text-lg font-semibold tracking-tight">{title}</RD.Title>
            {description ? (
              <RD.Description className="mt-1 text-sm text-fg-muted">{description}</RD.Description>
            ) : (
              <RD.Description className="sr-only">{title}</RD.Description>
            )}
          </div>
          {!hideClose && (
            <RD.Close
              className="-mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-white/8 hover:text-fg"
              aria-label="Close"
            >
              <X className="size-5" aria-hidden="true" />
            </RD.Close>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </RD.Content>
    </RD.Portal>
  );
}
