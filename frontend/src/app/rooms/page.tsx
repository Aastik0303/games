import { DoorOpen, Hash } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Rooms" };

export default function RoomsPage() {
  const options = [
    { href: "/rooms/new", icon: DoorOpen, title: "Create a room", body: "Host a game or a watch party and invite people with a code." },
    { href: "/rooms/join", icon: Hash, title: "Join with a code", body: "Enter the 8-character code someone shared with you." },
  ];
  return (
    <PageContainer width="narrow">
      <PageHeader eyebrow="Rooms" title="Private rooms" />
      <ul className="grid gap-4 sm:grid-cols-2">
        {options.map((o) => (
          <li key={o.href}>
            <Link href={o.href} className="glass flex h-full flex-col rounded-[var(--radius-panel)] p-6 transition-shadow hover:shadow-[var(--shadow-glow)]">
              <o.icon className="size-6 text-violet-300" aria-hidden="true" />
              <span className="mt-4 font-display text-lg font-semibold">{o.title}</span>
              <span className="mt-1 text-sm text-fg-muted">{o.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
