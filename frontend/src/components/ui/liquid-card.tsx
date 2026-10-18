"use client";

import Link from "next/link";
import type { ComponentProps, PointerEvent } from "react";
import { cn } from "@/lib/cn";

const MAX_TILT = 5; // degrees

/** Writes pointer position into CSS vars; the tilt and spotlight live in globals.css. */
function track(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--px", `${x * 100}%`);
  el.style.setProperty("--py", `${y * 100}%`);
  if (document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.style.setProperty("--rx", `${(x - 0.5) * MAX_TILT * 2}deg`);
  el.style.setProperty("--ry", `${(0.5 - y) * MAX_TILT * 2}deg`);
}

function reset(e: PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty("--rx", "0deg");
  e.currentTarget.style.setProperty("--ry", "0deg");
}

function Shine() {
  return <span className="liquid-card__shine" aria-hidden="true" />;
}

/** Neutral glass card with a white pointer spotlight, hover sheen and gentle 3D tilt. */
export function LiquidCard({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn("glass liquid-card rounded-[var(--radius-panel)]", className)}
      onPointerMove={track}
      onPointerLeave={reset}
      {...rest}
    >
      <Shine />
      {children}
    </div>
  );
}

/** Link version of {@link LiquidCard}: the whole card is the click target. */
export function LiquidCardLink({ className, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn("glass liquid-card rounded-[var(--radius-panel)]", className)}
      onPointerMove={track}
      onPointerLeave={reset}
      {...rest}
    >
      <Shine />
      {children}
    </Link>
  );
}
