"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@/lib/room-code";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";

export function validateJoinCode(raw: string): string | null {
  const code = normalizeRoomCode(raw);
  if (!code) return "Enter the invite code.";
  if ([...code].some((ch) => !ROOM_CODE_ALPHABET.includes(ch))) {
    return /[01IOL]/.test(code)
      ? "Codes never use 0, 1, I, L or O — check for look-alike characters."
      : "Codes only use letters and numbers.";
  }
  if (code.length !== ROOM_CODE_LENGTH) return `Codes are ${ROOM_CODE_LENGTH} characters (you entered ${code.length}).`;
  return null;
}

/**
 * Format-checks the code, then navigates to the room route which performs the
 * actual (rate-limited, server-side) join.
 */
export function JoinRoomForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateJoinCode(value);
    setError(problem);
    if (problem || !isValidRoomCode(value)) return;
    setNavigating(true);
    const code = normalizeRoomCode(value);
    setValue("");
    router.push(`/rooms/${code}`);
    setNavigating(false);
  }

  return (
    <Panel featured className="mx-auto max-w-md p-6 sm:p-8">
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label="Invite code" hint="8 characters, like ABCD-2345. Not case-sensitive." error={error}>
          {(p) => (
            <Input
              {...p}
              value={value}
              onChange={(e) => {
                setValue(e.target.value.toUpperCase());
                if (error) setError(null);
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              placeholder="XXXX-XXXX"
              className="h-14 text-center font-mono text-2xl tracking-[0.2em]"
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={navigating}>
          Join room <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
    </Panel>
  );
}
