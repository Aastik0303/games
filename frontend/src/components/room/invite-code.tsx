"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import { formatRoomCode } from "@/lib/room-code";
import { Button } from "@/components/ui/button";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without async clipboard permission.
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  }
}

export function InviteCode({ code, privacy }: { code: string; privacy: "private" | "open" }) {
  const [copied, setCopied] = useState<"code" | "link" | "failed" | null>(null);
  const formatted = formatRoomCode(code);

  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? formatted : `${window.location.origin}/rooms/${code}`;
    const ok = await copyText(text);
    setCopied(ok ? what : "failed");
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-xs text-fg-subtle">Invite code</p>
          <p className="font-mono text-2xl font-semibold tracking-[0.18em] text-fg" aria-label={`Invite code ${code.split("").join(" ")}`}>
            {formatted}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" icon={copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy("code")}>
            Copy code
          </Button>
          <Button size="sm" variant="ghost" icon={copied === "link" ? <Check className="size-4" /> : <Link2 className="size-4" />} onClick={() => void copy("link")}>
            Copy link
          </Button>
        </div>
      </div>
      <p className="text-xs text-fg-subtle">
        {privacy === "private"
          ? "Private room — only people with this code can join."
          : "Open room — matchmaking may fill empty seats with compatible players."}
      </p>
      <p className="sr-only" aria-live="polite">
        {copied === "code" ? "Invite code copied" : copied === "link" ? "Invite link copied" : copied === "failed" ? "Couldn't copy — select the code manually" : ""}
      </p>
    </div>
  );
}
