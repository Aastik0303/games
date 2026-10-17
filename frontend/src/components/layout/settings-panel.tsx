"use client";

import { Settings, ShieldCheck, Trash2, LogOut, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api, describeError, mockDev } from "@/lib/api";
import type { PrivacySettings } from "@/lib/api/types";
import { useActiveRoom } from "@/lib/active-room";
import { updateSettings, useDeviceSettings, resetSettings } from "@/lib/settings";
import { useApiQuery } from "@/lib/use-api-query";
import { useSession } from "@/components/providers/session-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

function Section({ title, children, description }: { title: string; children: ReactNode; description?: string }) {
  return (
    <section className="border-b border-line py-5 first:pt-1 last:border-b-0">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-subtle">{title}</h3>
      {description && <p className="mt-1 text-xs text-fg-subtle">{description}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="inline-flex size-10 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-white/8 hover:text-fg"
        aria-label="Settings"
      >
        <Settings className="size-5" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent side="right" title="Settings" description="Device preferences are saved in this browser. Privacy settings are saved to your account.">
        {open && <SettingsBody onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody({ onDone }: { onDone: () => void }) {
  const settings = useDeviceSettings();
  const { session, signOut, setSession } = useSession();
  const activeRoom = useActiveRoom();
  const router = useRouter();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const requestNotifications = async (enable: boolean) => {
    if (!enable) return updateSettings({ notifications: "off" });
    if (!("Notification" in window)) {
      toast.error("Notifications aren't supported in this browser.");
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission === "granted") updateSettings({ notifications: "turns_and_invites" });
    else toast.info("Notifications are blocked", "You can allow them in your browser's site settings.");
  };

  return (
    <div>
      <Section title="Audio">
        <Switch
          checked={settings.uiSounds}
          onCheckedChange={(uiSounds) => updateSettings({ uiSounds })}
          label="Interface sounds"
          description="Short tones when you're matched, when it's your turn, and on correct answers."
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="media-volume" className="flex justify-between text-sm text-fg">
            Default media volume <span className="tabular-nums text-fg-muted">{settings.mediaVolume}%</span>
          </label>
          <input
            id="media-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.mediaVolume}
            onChange={(e) => updateSettings({ mediaVolume: Number(e.target.value) })}
            className="accent-violet-400"
          />
        </div>
        <Switch
          checked={settings.captionsByDefault}
          onCheckedChange={(captionsByDefault) => updateSettings({ captionsByDefault })}
          label="Captions on by default"
          description="Applies in Watch Together when the video includes caption tracks."
        />
      </Section>

      <Section title="Notifications">
        <Switch
          checked={settings.notifications !== "off"}
          onCheckedChange={(v) => void requestNotifications(v)}
          label="Notify me about matches and turns"
          description="Only while Prism is open in a background tab. Your browser will ask for permission."
        />
      </Section>

      <Section title="Accessibility">
        <Segmented
          legend="Motion"
          name="motion"
          value={settings.motion}
          onChange={(motion) => updateSettings({ motion })}
          options={[
            { value: "system", label: "System" },
            { value: "reduce", label: "Reduced" },
            { value: "full", label: "Full" },
          ]}
        />
        <Segmented
          legend="Text size"
          name="text-size"
          value={settings.textSize}
          onChange={(textSize) => updateSettings({ textSize })}
          options={[
            { value: "default", label: "Default" },
            { value: "large", label: "Large" },
          ]}
        />
        <Switch
          checked={settings.contrast === "high"}
          onCheckedChange={(v) => updateSettings({ contrast: v ? "high" : "default" })}
          label="Higher contrast"
          description="Solid panels and brighter secondary text."
        />
      </Section>

      {session && <PrivacySection minor={session.profile.isMinor} />}
      {session && <BlockedSection />}

      <Section title="Session">
        {activeRoom && (
          <Button
            variant="outline"
            icon={<LogOut className="size-4" />}
            loading={busy === "leave"}
            onClick={async () => {
              setBusy("leave");
              try {
                await activeRoom.leave();
                onDone();
                router.push("/");
              } finally {
                setBusy(null);
              }
            }}
          >
            Leave room {activeRoom.code}
          </Button>
        )}
        {session ? (
          !confirmDelete ? (
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
              End session and delete my data
            </Button>
          ) : (
            <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3">
              <p className="text-sm text-fg">
                This signs you out and asks the server to delete your profile, preferences and block list. Moderation records
                required for safety may be retained as described in the privacy policy.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy === "delete"}
                  onClick={async () => {
                    setBusy("delete");
                    try {
                      await signOut();
                      resetSettings();
                      onDone();
                      router.push("/");
                      toast.success("Session ended", "Your data was deleted from this session.");
                    } catch (e) {
                      toast.error("Couldn't end session", describeError(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Yes, delete
                </Button>
              </div>
            </div>
          )
        ) : (
          <p className="text-sm text-fg-muted">You&apos;re not signed in. Device settings above still apply.</p>
        )}
      </Section>

      {mockDev && session && (
        <Section title="Developer (mock mode only)" description="These controls exist only with the mock adapter and are stripped from real-backend builds.">
          <div className="flex items-center gap-2 text-xs text-warning">
            <Wrench className="size-4" aria-hidden="true" /> Fixture tools — not real permissions.
          </div>
          <Switch
            checked={session.user.roles.includes("admin")}
            onCheckedChange={async (enabled) => {
              mockDev?.setAdmin(enabled);
              const next = await api.session.current();
              if (next) setSession(next);
            }}
            label="Mock admin role"
            description="Lets you preview the admin dashboard against fixture data."
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => mockDev?.dropConnections()}>
              Simulate connection drop
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                mockDev?.expireSession();
                toast.info("Session will be rejected on the next request.");
              }}
            >
              Expire session
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}

function PrivacySection({ minor }: { minor: boolean }) {
  const toast = useToast();
  const query = useApiQuery("privacy", (signal) => api.privacy.get({ signal }));
  const [pending, setPending] = useState<PrivacySettings | null>(null);
  const value = pending ?? query.data;

  const save = async (next: PrivacySettings) => {
    setPending(next); // optimistic: privacy toggles are idempotent and easily reverted
    try {
      await api.privacy.update(next);
      query.reload();
    } catch (e) {
      toast.error("Couldn't save privacy settings", describeError(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <Section title="Privacy" description="Saved to your account. Prism never shows your age band, location or contact details to other players.">
      {!value ? (
        query.error ? (
          <p className="text-sm text-danger">{describeError(query.error)}</p>
        ) : (
          <Skeleton className="h-28" />
        )
      ) : (
        <>
          <Switch
            checked={value.showOnlineStatus}
            onCheckedChange={(showOnlineStatus) => void save({ ...value, showOnlineStatus })}
            label="Show when I'm online"
            description="Others in your rooms still see you while you're in the same room."
          />
          <Segmented
            legend="Who can invite me"
            name="invite-policy"
            value={value.invitePolicy}
            onChange={(invitePolicy) => void save({ ...value, invitePolicy })}
            options={[
              { value: "anyone_with_code", label: "Anyone with a code", disabled: minor },
              { value: "matched_only", label: "Matched players only" },
            ]}
          />
          <Segmented
            legend="Chat filter"
            name="chat-filter"
            value={value.chatFilter}
            onChange={(chatFilter) => void save({ ...value, chatFilter })}
            options={[
              { value: "standard", label: "Standard", disabled: minor },
              { value: "strict", label: "Strict" },
            ]}
          />
          {minor && (
            <p className="flex items-start gap-2 text-xs text-fg-subtle">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden="true" />
              Because you&apos;re under 18, strict chat filtering and matched-only invites stay on.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function BlockedSection() {
  const toast = useToast();
  const query = useApiQuery("blocked", (signal) => api.moderation.blocked({ signal }));
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <Section title="Blocked players" description="Blocked players can't join your rooms or see your messages, and you won't see theirs.">
      {query.loading && !query.data ? (
        <Skeleton className="h-12" />
      ) : query.error ? (
        <p className="text-sm text-danger">{describeError(query.error)}</p>
      ) : query.data && query.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {query.data.map((user) => (
            <li key={user.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <Avatar user={user} size="sm" />
                <span className="truncate text-sm">{user.displayName}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                loading={removing === user.id}
                onClick={async () => {
                  setRemoving(user.id);
                  try {
                    await api.moderation.unblock(user.id);
                    query.reload();
                  } catch (e) {
                    toast.error("Couldn't unblock", describeError(e));
                  } finally {
                    setRemoving(null);
                  }
                }}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">You haven&apos;t blocked anyone.</p>
      )}
    </Section>
  );
}
