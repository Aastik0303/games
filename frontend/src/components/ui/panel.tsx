import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PanelProps extends ComponentProps<"div"> {
  as?: "div" | "section" | "article" | "aside";
  featured?: boolean;
}

/** Glass surface used for cards, side panels and content blocks. */
export function Panel({ as: Tag = "div", featured, className, ...rest }: PanelProps) {
  return <Tag className={cn("glass rounded-[var(--radius-panel)]", featured && "prism-edge", className)} {...rest} />;
}

export function PanelHeader({
  title,
  description,
  actions,
  as: Heading = "h2",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <Heading className="font-display text-lg font-semibold tracking-tight text-fg">{title}</Heading>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
