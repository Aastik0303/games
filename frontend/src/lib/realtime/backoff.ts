export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Fraction of the delay randomised (0..1) to avoid reconnect stampedes. */
  jitter: number;
  maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  maxMs: 15_000,
  jitter: 0.3,
  maxAttempts: 10,
};

/**
 * Bounded exponential backoff with symmetric jitter.
 * attempt is 1-based. Returns null once maxAttempts is exceeded.
 */
export function backoffDelay(
  attempt: number,
  opts: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number | null {
  if (attempt < 1 || attempt > opts.maxAttempts) return null;
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** (attempt - 1));
  const spread = exp * opts.jitter;
  const delay = exp - spread + random() * spread * 2;
  return Math.round(Math.min(opts.maxMs, Math.max(0, delay)));
}
