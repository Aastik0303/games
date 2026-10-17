import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Community guidelines" };

const RULES = [
  { title: "Be kind", body: "Trash talk about the puzzle is fine. Insults, harassment and hate aimed at people are not." },
  { title: "Keep personal details private", body: "Don't ask for or share real names, schools, addresses, phone numbers or social handles — especially with younger players." },
  { title: "Play fair", body: "No answer-sharing bots, griefing or deliberately ruining a round for others." },
  { title: "Only share what you're allowed to", body: "Watch Together is for content you have the right to share. Don't stream paid services or anything you don't have permission for." },
  { title: "Use report and block", body: "If something feels wrong, report it from the chat menu. Reports are reviewed by people, and blocking takes effect immediately." },
];

export default function GuidelinesPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader eyebrow="Community" title="Community guidelines" description="Prism works when everyone can relax and play. These rules apply in every room." />
      <Panel className="p-6 sm:p-8">
        <ol className="flex flex-col gap-6">
          {RULES.map((rule, i) => (
            <li key={rule.title} className="flex gap-4">
              <span className="font-display text-lg font-semibold text-violet-300 tabular-nums" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="font-semibold">{rule.title}</h2>
                <p className="mt-1 text-sm text-fg-muted">{rule.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </PageContainer>
  );
}
