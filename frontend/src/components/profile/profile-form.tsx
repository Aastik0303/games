"use client";

import { Info, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { describeError, isApiError } from "@/lib/api/errors";
import { INTERESTS, LANGUAGES, type Profile, type ProfileInput, type Session } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Checkbox, ChipGroup, Field, Input, Segmented, Select } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import {
  AGE_LABELS,
  MAX_INTERESTS,
  draftFromProfile,
  emptyDraft,
  toProfileInput,
  validateProfile,
  type AgeChoice,
  type ProfileDraft,
  type ProfileErrors,
} from "./profile-validation";

const FIELD_IDS: Record<keyof ProfileErrors, string> = {
  displayName: "profile-name",
  ageBand: "profile-age",
  guidelinesAccepted: "profile-guidelines",
  interests: "profile-interests",
};

function Fieldset({ legend, why, children }: { legend: string; why?: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-line pt-6 first-of-type:border-t-0 first-of-type:pt-0">
      <legend className="font-display text-base font-semibold tracking-tight">{legend}</legend>
      {why && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-fg-subtle">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" /> {why}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </fieldset>
  );
}

export function ProfileForm({
  existing,
  onSubmit,
}: {
  existing?: Profile | null;
  onSubmit: (input: ProfileInput) => Promise<Session>;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(() => (existing ? draftFromProfile(existing) : emptyDraft()));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const errors = validateProfile(draft);
  const visibleErrors: ProfileErrors = submitted ? errors : {};
  const errorList = Object.entries(visibleErrors) as [keyof ProfileErrors, string][];

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(errors).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setSaving(true);
    try {
      await onSubmit(toProfileInput(draft));
    } catch (err) {
      const fieldMsg = isApiError(err) && err.fieldErrors ? Object.values(err.fieldErrors)[0] : null;
      setServerError(fieldMsg ?? describeError(err));
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }

  const isMinorChoice = draft.ageBand === "13_15" || draft.ageBand === "16_17";

  return (
    <form noValidate onSubmit={handleSubmit} aria-describedby="profile-privacy-note">
      {(errorList.length > 0 || serverError) && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="mb-6 rounded-2xl border border-danger/35 bg-danger/10 p-4 outline-none">
          <p className="text-sm font-semibold text-danger">{serverError ? "We couldn't save your profile" : "Please fix the following"}</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-fg">
            {serverError && <li>{serverError}</li>}
            {errorList.map(([key, msg]) => (
              <li key={key}>
                <a href={`#${FIELD_IDS[key]}`} className="underline underline-offset-2">
                  {msg}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Panel className="flex flex-col gap-8 p-5 sm:p-8">
        <Fieldset legend="About you" why="Only your display name is visible to other players.">
          <Field id={FIELD_IDS.displayName} label="Display name" hint="2–24 characters. No real names or contact details, please." error={visibleErrors.displayName}>
            {(p) => (
              <Input
                {...p}
                value={draft.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                autoComplete="nickname"
                maxLength={32}
                required
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id={FIELD_IDS.ageBand}
              label="Age band"
              hint="We use this for safety defaults. It's never shown to anyone."
              error={visibleErrors.ageBand}
            >
              {(p) => (
                <Select {...p} value={draft.ageBand} onChange={(e) => set("ageBand", e.target.value as AgeChoice)} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {Object.entries(AGE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Language" hint="Used to match you with people you can chat with.">
              {(p) => (
                <Select {...p} value={draft.language} onChange={(e) => set("language", e.target.value as ProfileDraft["language"])}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {isMinorChoice && (
            <p className="flex items-start gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/5 p-3 text-sm text-fg-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden="true" />
              Players under 18 are matched only with people in their own age group, have strict chat filtering on, and can only be invited
              through matchmaking.
            </p>
          )}
        </Fieldset>

        <Fieldset legend="Interests" why="Optional. Used only to find people who enjoy similar things — never shown publicly, never used to rank people.">
          <Checkbox
            checked={draft.useInterestsForMatching}
            onChange={(e) => set("useInterestsForMatching", e.target.checked)}
            label="Use my interests to improve matches"
            description="If this is off, your interests aren't sent to Prism at all."
          />
          <div id={FIELD_IDS.interests} aria-disabled={!draft.useInterestsForMatching} className={draft.useInterestsForMatching ? "" : "pointer-events-none opacity-40"}>
            <ChipGroup
              label={`Interests, up to ${MAX_INTERESTS}`}
              options={INTERESTS}
              value={draft.interests}
              onChange={(interests) => set("interests", interests)}
              max={MAX_INTERESTS}
            />
            <p className="mt-2 text-xs text-fg-subtle">
              {draft.interests.length}/{MAX_INTERESTS} selected
            </p>
            {visibleErrors.interests && <p className="text-xs text-danger">{visibleErrors.interests}</p>}
          </div>
        </Fieldset>

        <Fieldset legend="Accessibility" why="Optional. Helps us adapt games — for example, longer timers in rooms you join.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Checkbox
              checked={draft.accessibility.extendedTimers}
              onChange={(e) => set("accessibility", { ...draft.accessibility, extendedTimers: e.target.checked })}
              label="Extended timers"
              description="1.5× time on timed rounds."
            />
            <Checkbox
              checked={draft.accessibility.captions}
              onChange={(e) => set("accessibility", { ...draft.accessibility, captions: e.target.checked })}
              label="Prefer captions"
              description="Turn captions on when media provides them."
            />
            <Checkbox
              checked={draft.accessibility.screenReaderOptimized}
              onChange={(e) => set("accessibility", { ...draft.accessibility, screenReaderOptimized: e.target.checked })}
              label="Screen-reader friendly games"
              description="Prefer activities that work fully without visuals."
            />
            <Checkbox
              checked={draft.accessibility.colorSafePalette}
              onChange={(e) => set("accessibility", { ...draft.accessibility, colorSafePalette: e.target.checked })}
              label="Colour-safe indicators"
              description="Never rely on colour alone for game state."
            />
          </div>
        </Fieldset>

        <Fieldset legend="Matching preferences" why="Optional. These only reorder compatible players; nobody is excluded because of who they are.">
          <Segmented
            legend="Play style"
            name="play-style"
            value={draft.matching.playStyle}
            onChange={(playStyle) => set("matching", { ...draft.matching, playStyle })}
            options={[
              { value: "casual", label: "Casual" },
              { value: "any", label: "No preference" },
              { value: "competitive", label: "Competitive" },
            ]}
          />
          <Checkbox
            checked={draft.matching.preferSameLanguage}
            onChange={(e) => set("matching", { ...draft.matching, preferSameLanguage: e.target.checked })}
            label="Prefer players who speak my language"
          />
          <Checkbox
            checked={draft.useInterestsForMatching && draft.matching.preferSharedInterests}
            disabled={!draft.useInterestsForMatching}
            onChange={(e) => set("matching", { ...draft.matching, preferSharedInterests: e.target.checked })}
            label="Prefer players with shared interests"
            description={draft.useInterestsForMatching ? undefined : "Turn on interest-based matching above to use this."}
          />
        </Fieldset>

        <Fieldset legend="Consent">
          <div id={FIELD_IDS.guidelinesAccepted}>
            <Checkbox
              checked={draft.guidelinesAccepted}
              onChange={(e) => set("guidelinesAccepted", e.target.checked)}
              aria-invalid={visibleErrors.guidelinesAccepted ? true : undefined}
              label={
                <>
                  I agree to the{" "}
                  <Link href="/guidelines" target="_blank" className="underline underline-offset-2">
                    community guidelines
                  </Link>
                </>
              }
            />
            {visibleErrors.guidelinesAccepted && <p className="mt-1 pl-8 text-xs font-medium text-danger">{visibleErrors.guidelinesAccepted}</p>}
          </div>
          <p id="profile-privacy-note" className="text-xs text-fg-subtle">
            We don&apos;t ask for gender, birth date, location or contact details. You can delete your data any time from Settings.{" "}
            <Link href="/privacy" className="underline underline-offset-2">
              How we use this
            </Link>
          </p>
        </Fieldset>

        <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-6">
          <Button type="submit" variant="primary" size="lg" loading={saving}>
            {existing ? "Save profile" : "Create profile"}
          </Button>
        </div>
      </Panel>
    </form>
  );
}
