import { Bot } from "lucide-react";
import type { PublicUser } from "@/lib/api/types";
import { cn } from "@/lib/cn";

const sizes = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-12 text-sm" };

/** Initials avatar tinted by the server-provided hue. Decorative; the name is always shown alongside. */
export function Avatar({ user, size = "md", className }: { user: Pick<PublicUser, "displayName" | "avatarHue" | "isBot">; size?: keyof typeof sizes; className?: string }) {
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-ink-950", sizes[size], className)}
      style={{
        background: `linear-gradient(135deg, hsl(${user.avatarHue} 85% 78%), hsl(${(user.avatarHue + 50) % 360} 80% 68%))`,
      }}
    >
      {initials}
      {user.isBot && (
        <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border border-ink-900 bg-ink-600 text-fg">
          <Bot className="size-2.5" />
        </span>
      )}
    </span>
  );
}
