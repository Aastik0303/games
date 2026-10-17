import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <div className="px-4 py-16">
      <EmptyState
        icon={<Compass className="size-6" />}
        title={<span className="font-display">This page wandered off</span>}
        actions={
          <>
            <ButtonLink href="/" variant="primary">
              Back to Prism
            </ButtonLink>
            <ButtonLink href="/rooms/join" variant="ghost">
              Join a room
            </ButtonLink>
          </>
        }
      >
        We couldn&apos;t find that page. If you followed an invite link, the room may have closed.
      </EmptyState>
    </div>
  );
}
