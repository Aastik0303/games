"use client";

import { MoreHorizontal, RotateCw, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { PendingMessage } from "./room-reducer";
import type { ModerationTarget } from "./moderation-dialog";

const MAX_LEN = 300;
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function ChatPanel({
  messages,
  pending,
  selfId,
  canSend,
  disabledReason,
  onSend,
  onRetry,
  onDiscard,
  onModerate,
}: {
  messages: ChatMessage[];
  pending: PendingMessage[];
  selfId: string;
  canSend: boolean;
  disabledReason?: string;
  onSend: (text: string) => void;
  onRetry: (clientMsgId: string, text: string) => void;
  onDiscard: (clientMsgId: string) => void;
  onModerate: (target: ModerationTarget) => void;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

  // Auto-scroll only when the reader is already near the bottom.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !canSend) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ol
        ref={listRef}
        role="log"
        aria-label="Room chat"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && pending.length === 0 && <li className="py-8 text-center text-sm text-fg-subtle">No messages yet. Say hi!</li>}
        {messages.map((m) =>
          m.kind === "system" ? (
            <li key={m.id} className="text-center text-xs text-fg-subtle">
              {m.text}
            </li>
          ) : (
            <li key={m.id} className="group flex items-start gap-2.5">
              <Avatar user={m.author} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2 text-xs">
                  <span className={cn("font-semibold", m.author.id === selfId ? "text-cyan-300" : "text-fg")}>
                    {m.author.id === selfId ? "You" : m.author.displayName}
                  </span>
                  {m.author.isBot && <span className="text-fg-subtle">mock player</span>}
                  <time dateTime={m.sentAt} className="text-fg-subtle">
                    {time.format(new Date(m.sentAt))}
                  </time>
                </p>
                <p className="break-words text-sm text-fg">{m.text}</p>
              </div>
              {m.author.id !== selfId && (
                <button
                  type="button"
                  onClick={() => onModerate({ user: m.author, messageId: m.id, excerpt: m.text.slice(0, 80) })}
                  className="rounded-md p-1 text-fg-subtle opacity-60 hover:bg-white/8 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Report or block ${m.author.displayName}`}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ),
        )}
        {pending.map((p) => (
          <li key={p.clientMsgId} className="flex items-start gap-2.5 opacity-80">
            <span className="mt-0.5 size-7 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <span className="font-semibold text-cyan-300">You</span>{" "}
                <span className={p.status === "failed" ? "text-danger" : "text-fg-subtle"}>{p.status === "failed" ? `Not sent — ${p.error}` : "Sending…"}</span>
              </p>
              <p className="break-words text-sm text-fg">{p.text}</p>
              {p.status === "failed" && (
                <div className="mt-1 flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" icon={<RotateCw className="size-3.5" />} onClick={() => onRetry(p.clientMsgId, p.text)}>
                    Retry
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" icon={<Trash2 className="size-3.5" />} onClick={() => onDiscard(p.clientMsgId)}>
                    Discard
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            rows={1}
            value={text}
            maxLength={MAX_LEN}
            disabled={!canSend}
            placeholder={canSend ? "Message the room" : disabledReason}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-line-strong bg-ink-850/80 px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-transparent disabled:opacity-60"
          />
          <Button type="submit" size="icon" variant="primary" aria-label="Send message" disabled={!canSend || !text.trim()}>
            <Send className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <p className={cn("mt-1 text-right text-[11px] tabular-nums", text.length > MAX_LEN - 30 ? "text-warning" : "text-fg-subtle")} aria-hidden={text.length < MAX_LEN - 30}>
          {text.length}/{MAX_LEN}
        </p>
      </form>
    </div>
  );
}
