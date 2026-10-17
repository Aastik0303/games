import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
        {description && <p className="mt-3 text-base text-fg-muted text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function PageContainer({ children, width = "default" }: { children: ReactNode; width?: "default" | "narrow" | "wide" }) {
  const max = width === "narrow" ? "max-w-3xl" : width === "wide" ? "max-w-[96rem]" : "max-w-7xl";
  return <div className={`mx-auto w-full ${max} px-4 py-8 sm:px-6 sm:py-12`}>{children}</div>;
}
