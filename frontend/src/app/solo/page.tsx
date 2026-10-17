import type { Metadata } from "next";
import { GameLibrary } from "@/components/games/game-library";
import { PageContainer, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Solo games" };

export default function SoloPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Solo"
        title="Play at your own pace"
        description="Short, satisfying puzzles. Your answers are checked by the server, so scores are fair everywhere."
      />
      <GameLibrary />
    </PageContainer>
  );
}
