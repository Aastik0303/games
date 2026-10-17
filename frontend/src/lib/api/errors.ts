export type ApiErrorCode =
  | "unauthorized"
  | "session_expired"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "room_full"
  | "conflict"
  | "network"
  | "timeout"
  | "aborted"
  | "server";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryAfterSec?: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { status?: number; retryAfterSec?: number; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = opts.status ?? 0;
    this.retryAfterSec = opts.retryAfterSec;
    this.fieldErrors = opts.fieldErrors;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isAbort(value: unknown): boolean {
  return (
    (value instanceof ApiError && value.code === "aborted") ||
    (value instanceof DOMException && value.name === "AbortError")
  );
}

/** Human-facing copy. Never surfaces raw server messages for 5xx errors. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";
  switch (error.code) {
    case "unauthorized":
    case "session_expired":
      return "Your session has ended. Set up your profile again to continue.";
    case "forbidden":
      return "You don't have permission to do that.";
    case "not_found":
      return error.message || "We couldn't find that.";
    case "rate_limited":
      return error.retryAfterSec
        ? `You're going a little fast. Try again in ${error.retryAfterSec}s.`
        : "You're going a little fast. Try again shortly.";
    case "room_full":
      return "That room is full.";
    case "network":
      return "Can't reach Prism right now. Check your connection.";
    case "timeout":
      return "The request took too long. Please try again.";
    case "validation":
    case "conflict":
      return error.message;
    default:
      return "Something went wrong on our side. Please try again.";
  }
}
