import type { AccessibilityPrefs, AgeBand, Interest, LanguageCode, MatchingPrefs, Profile, ProfileInput } from "@/lib/api/types";

export type AgeChoice = AgeBand | "under_13" | "";

export interface ProfileDraft {
  displayName: string;
  ageBand: AgeChoice;
  language: LanguageCode;
  interests: Interest[];
  accessibility: AccessibilityPrefs;
  matching: MatchingPrefs;
  guidelinesAccepted: boolean;
  useInterestsForMatching: boolean;
}

export type ProfileErrors = Partial<Record<"displayName" | "ageBand" | "guidelinesAccepted" | "interests", string>>;

export const AGE_LABELS: Record<Exclude<AgeChoice, "">, string> = {
  under_13: "Under 13",
  "13_15": "13–15",
  "16_17": "16–17",
  "18_24": "18–24",
  "25_34": "25–34",
  "35_49": "35–49",
  "50_plus": "50+",
};

export const MAX_INTERESTS = 5;

export function emptyDraft(language: LanguageCode = "en"): ProfileDraft {
  return {
    displayName: "",
    ageBand: "",
    language,
    interests: [],
    accessibility: { captions: false, screenReaderOptimized: false, colorSafePalette: false, extendedTimers: false },
    matching: { preferSharedInterests: true, preferSameLanguage: true, playStyle: "any" },
    guidelinesAccepted: false,
    useInterestsForMatching: false,
  };
}

export function draftFromProfile(p: Profile): ProfileDraft {
  return {
    displayName: p.displayName,
    ageBand: p.ageBand,
    language: p.language,
    interests: p.interests,
    accessibility: p.accessibility,
    matching: p.matching,
    guidelinesAccepted: p.consent.guidelinesAccepted,
    useInterestsForMatching: p.consent.useInterestsForMatching,
  };
}

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;
const CONTACT_PATTERN = /(@|https?:|www\.|\.com\b|\d{6,})/i;

/** Client-side checks for fast feedback; the server re-validates everything. */
export function validateProfile(d: ProfileDraft): ProfileErrors {
  const errors: ProfileErrors = {};
  const name = d.displayName.trim();
  if (name.length < 2) errors.displayName = "Use at least 2 characters.";
  else if (name.length > 24) errors.displayName = "Use 24 characters or fewer.";
  else if (!NAME_PATTERN.test(name)) errors.displayName = "Use letters, numbers, spaces, dots, dashes or underscores.";
  else if (CONTACT_PATTERN.test(name)) errors.displayName = "Keep contact details (emails, links, phone numbers) out of your name.";

  if (!d.ageBand) errors.ageBand = "Choose your age band.";
  else if (d.ageBand === "under_13") errors.ageBand = "Prism is for people aged 13 and over. Thanks for checking us out!";

  if (d.interests.length > MAX_INTERESTS) errors.interests = `Pick up to ${MAX_INTERESTS} interests.`;
  if (!d.guidelinesAccepted) errors.guidelinesAccepted = "Please agree to the community guidelines to continue.";
  return errors;
}

export function toProfileInput(d: ProfileDraft): ProfileInput {
  if (!d.ageBand || d.ageBand === "under_13" || !d.guidelinesAccepted) throw new Error("Draft is not valid");
  return {
    displayName: d.displayName.trim(),
    ageBand: d.ageBand,
    language: d.language,
    // Interests are only sent when the person opted in to interest-based matching.
    interests: d.useInterestsForMatching ? d.interests : [],
    accessibility: d.accessibility,
    matching: { ...d.matching, preferSharedInterests: d.useInterestsForMatching && d.matching.preferSharedInterests },
    consent: { guidelinesAccepted: true, useInterestsForMatching: d.useInterestsForMatching },
  };
}

/** Only allow same-origin relative redirects (no "//evil.com"). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
