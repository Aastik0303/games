import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none " +
  "rounded-[var(--radius-control)] transition-[background,box-shadow,transform,opacity,border-color] duration-200 " +
  "disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px";

const variants: Record<ButtonVariant, string> = {
  primary:
    "text-ink-950 bg-[linear-gradient(120deg,#c4b5fd,#67e8f9_60%,#f9a8d4)] hover:shadow-[var(--shadow-glow)] " +
    "hover:brightness-105 disabled:hover:shadow-none",
  secondary: "glass text-fg hover:bg-glass-strong hover:border-line-strong",
  outline: "border border-line-strong text-fg hover:bg-glass-strong",
  ghost: "text-fg-muted hover:text-fg hover:bg-glass-strong",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10 p-0",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function ButtonLink({ variant = "secondary", size = "md", icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
