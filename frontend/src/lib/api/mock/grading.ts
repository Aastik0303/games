/**
 * MOCK SERVER LOGIC — answer grading. In production this lives in the backend;
 * the browser never receives solutions before a puzzle closes.
 */
const ARTICLES = /^(a|an|the)\s+/;

export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(ARTICLES, "");
}

/** Accepts any listed variant, ignoring case, punctuation, articles and a trailing plural "s". */
export function matchesAnswer(guess: string, accepted: string[]): boolean {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  return accepted.some((a) => {
    const n = normalizeAnswer(a);
    return g === n || g === `${n}s` || `${g}s` === n;
  });
}
