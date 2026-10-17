"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const controlBase =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-ink-850/80 px-3.5 text-sm text-fg " +
  "placeholder:text-fg-subtle transition-colors hover:border-white/25 " +
  "focus-visible:outline-2 focus-visible:outline-cyan-300 focus-visible:border-transparent " +
  "aria-[invalid=true]:border-danger/70 disabled:opacity-60";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/**
 * Label + control + hint + error with correct ARIA wiring. The control is
 * provided as a render function receiving the ids it must use.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
  id: idProp,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const generated = useId();
  const id = idProp ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {optional && <span className="ml-1.5 text-xs font-normal text-fg-subtle">(optional)</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(controlBase, "h-11", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlBase, "min-h-24 py-2.5", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={cn(controlBase, "h-11 appearance-none bg-[length:16px] pr-9", "select-chevron", className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-violet-400"
        aria-describedby={description ? `${id}-d` : undefined}
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm text-fg">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-xs text-fg-subtle">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** Multi-select chips implemented as toggle buttons (aria-pressed). */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  max,
  renderLabel = (v) => v,
}: {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
  max?: number;
  renderLabel?: (v: T) => ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value.includes(option);
        const atMax = max !== undefined && value.length >= max && !selected;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            disabled={atMax}
            onClick={() => onChange(selected ? value.filter((v) => v !== option) : [...value, option])}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm capitalize transition-colors disabled:opacity-40",
              selected
                ? "border-violet-400/60 bg-violet-400/15 text-violet-300"
                : "border-line-strong text-fg-muted hover:border-white/25 hover:text-fg",
            )}
          >
            {renderLabel(option)}
          </button>
        );
      })}
    </div>
  );
}

/** Single-choice segmented control backed by native radios (arrow-key navigation for free). */
export function Segmented<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  hideLegend,
  disabled,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  hideLegend?: boolean;
  disabled?: boolean;
}) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className={cn("mb-1.5 text-sm font-medium text-fg", hideLegend && "sr-only")}>{legend}</legend>
      <div className="flex flex-wrap gap-1 rounded-[var(--radius-control)] border border-line bg-ink-850/60 p-1">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={String(option.value)}
              className={cn(
                "relative flex h-9 min-w-12 flex-1 cursor-pointer items-center justify-center rounded-lg px-3 text-sm transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cyan-300",
                checked ? "bg-white/10 text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                option.disabled && "cursor-not-allowed opacity-40",
              )}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
