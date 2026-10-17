import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "violet" | "cyan" | "magenta" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-white/6 text-fg-muted border-line",
  violet: "bg-violet-400/12 text-violet-300 border-violet-400/25",
  cyan: "bg-cyan-400/10 text-cyan-300 border-cyan-400/25",
  magenta: "bg-magenta-400/10 text-magenta-300 border-magenta-400/25",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
};

export function Badge({ tone = "neutral", className, ...rest }: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-5",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
