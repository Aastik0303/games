import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Privacy" };

const ITEMS = [
  { q: "What we ask for", a: "A display name, an age band, your language, and — only if you choose — interests, accessibility needs and matching preferences. We never ask for your gender, birth date, location or contact details." },
  { q: "Why we ask for an age band", a: "So we can apply age-appropriate safety defaults: stricter chat filtering for under-18s and matching only within the same age group. Your age band is never shown to other players." },
  { q: "How interests are used", a: "Only for matching, and only if you opt in. Matching never ranks people by personal traits; it uses the activity you picked, language, availability, accessibility needs and fair queue time." },
  { q: "What other players see", a: "Your display name, a generated avatar colour, whether you're ready, and your messages in rooms you share." },
  { q: "Deleting your data", a: "Open Settings → Session → End session and delete my data. Moderation records needed to keep people safe may be retained for a limited period." },
];

export default function PrivacyPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader eyebrow="Privacy" title="What Prism collects, and why" description="Plain-language summary. The binding policy is published by the service operator." />
      <Panel className="divide-y divide-line">
        {ITEMS.map((item) => (
          <section key={item.q} className="p-6">
            <h2 className="font-semibold">{item.q}</h2>
            <p className="mt-1.5 text-sm text-fg-muted">{item.a}</p>
          </section>
        ))}
      </Panel>
    </PageContainer>
  );
}
