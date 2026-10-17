"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingBlock, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ProfileForm } from "./profile-form";
import { safeNext } from "./profile-validation";

export function ProfileScreen() {
  const { status, session, setSession, retry } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const next = safeNext(params.get("next"));
  const editing = status === "authenticated" && session;

  return (
    <>
      <PageHeader
        eyebrow={editing ? "Profile" : "Welcome"}
        title={editing ? "Your profile" : "Set up your Prism profile"}
        description="Just the essentials. Everything optional is clearly marked, with a note on why we ask."
      />
      {status === "loading" ? (
        <LoadingBlock label="Loading profile">
          <Skeleton className="h-[40rem]" />
        </LoadingBlock>
      ) : status === "error" ? (
        <ErrorState actions={<Button onClick={retry}>Try again</Button>}>We couldn&apos;t load your session.</ErrorState>
      ) : (
        <ProfileForm
          key={session?.user.id ?? "new"}
          existing={editing ? session.profile : null}
          onSubmit={async (input) => {
            const saved = editing ? await api.session.updateProfile(input) : await api.session.create(input);
            setSession(saved);
            toast.success(editing ? "Profile saved" : `Welcome, ${saved.user.displayName}!`);
            router.push(editing && next === "/" ? "/" : next);
            return saved;
          }}
        />
      )}
    </>
  );
}
