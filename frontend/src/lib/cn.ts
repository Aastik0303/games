type ClassValue = string | false | null | undefined | 0;

/** Joins truthy class names. Tiny on purpose; no merge semantics. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
