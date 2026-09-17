import { memo, useState } from "react";
import { Check, CheckCheck, Clock, Copy, Languages, Loader2 as Spinner, ScanText, Sparkles, X } from "lucide-react";
import { mediaKind, requireClient } from "@/store/settings";
import { Avatar } from "@/components/ui";
import { MediaView } from "@/components/MediaView";
import { type MenuPos } from "@/components/MessageMenu";
import { QuoteView, type ReplyTo } from "@/components/QuoteView";
import { LinkPreviewCard } from "@/components/LinkPreview";
import { bareId, summarize, useReactions } from "@/store/reactions";
import { usePolls } from "@/store/polls";
import { useTranslations } from "@/store/translations";
import { useImageNotes } from "@/store/imageNotes";
import { langName } from "@/lib/ai";
import type { MentionResolver } from "@/lib/waMarkdown";
import { WaMarkdown } from "@/lib/waMarkdown";
import type { ViewMessage, WAMessage } from "@/api/types";
import { cn, displayId, formatTime, errMsg } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";

export function senderName(m: WAMessage) {
  const d = (m._data ?? {}) as { Info?: { PushName?: string } };
  return d.Info?.PushName || displayId(m.participant || m.from) || "Unknown";
}

/** One message. Memoised: a chat with hundreds of loaded bubbles must not re-render them all on every presence/typing tick. */
export const Bubble = memo(function Bubble({
  message: m,
  group,
  session,
  chatId,
  onReply: onReplyMsg,
  onMenu: onMenuMsg,
  resolveName,
  myIds,
  onJump,
  onSender,
}: {
  message: WAMessage;
  group: boolean;
  session: string;
  chatId: string;
  onReply: (m: WAMessage) => void;
  onMenu: (m: WAMessage, pos: MenuPos) => void;
  resolveName: MentionResolver;
  myIds: string[];
  onJump: (id: string) => void;
  onSender: (id: string) => void;
}) {
  const onReply = () => onReplyMsg(m);
  const onMenu = (pos: MenuPos) => onMenuMsg(m, pos);
  const mine = m.fromMe;
  const { revoked, waiting } = m as ViewMessage;
  // Hooks must run before the waiting/revoked early returns: a message can flip between
  // those states in place (same key), and a changing hook count would crash the bubble.
  const reactionMap = useReactions((s) => s.byMsg[bareId(m.id)]);
  if (waiting) {
    return (
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div
          className="max-w-[70%] rounded-lg px-3 py-1.5 text-sm italic text-neutral-500 dark:text-neutral-400 border border-dashed border-amber-400/60 bg-amber-50/60 dark:bg-amber-900/20"
          title="WhatsApp could not deliver the encryption key for this message to this session yet. It is retried automatically; the sender's phone has to be online."
        >
          {group && !mine && (
            <div className="text-[11px] font-semibold not-italic text-wa-dark dark:text-wa mb-0.5">
              {resolveName(m.participant || m.from) ?? senderName(m)}
            </div>
          )}
          ⏳ Waiting for this message. This may take a while.
          <div className="text-right text-[10px] not-italic mt-0.5">{formatTime(m.timestamp)}</div>
        </div>
      </div>
    );
  }
  if (revoked) {
    return (
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "max-w-[70%] rounded-lg px-3 py-1.5 text-sm italic text-neutral-500 dark:text-neutral-400 border border-dashed",
            mine
              ? "border-wa-dark/40 bg-[#d9fdd3]/40 dark:bg-wa-teal/30"
              : "border-neutral-300 dark:border-neutral-700 bg-white/60 dark:bg-neutral-800/60",
          )}
        >
          {group && !mine && (
            <div className="text-[11px] font-semibold not-italic text-wa-dark dark:text-wa mb-0.5">
              {resolveName(m.participant || m.from) ?? senderName(m)}
            </div>
          )}
          🚫 {mine ? "You deleted this message" : "This message was deleted"}
          <div className="text-right text-[10px] not-italic mt-0.5">{formatTime(m.timestamp)}</div>
        </div>
      </div>
    );
  }
  const sticker = m.hasMedia && !m.body && mediaKind(m) === "sticker";
  const reactions = summarize(
    reactionMap,
    myIds.map((x) => x.split("@")[0]!.split(":")[0]!),
  );
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("flex flex-col max-w-[70%]", mine ? "items-end" : "items-start")}>
        <div
          onDoubleClick={onReply}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu({ x: e.clientX, y: e.clientY });
          }}
          title="Double-click to reply · right-click for more"
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm selectable",
            sticker
              ? "bg-transparent"
              : mine
                ? "bg-[#d9fdd3] dark:bg-wa-teal text-neutral-900 dark:text-white shadow-sm"
                : "bg-white dark:bg-neutral-800 shadow-sm",
          )}
        >
          {group && !mine && (
            <button
              onClick={() => onSender(m.participant || m.from)}
              className="block text-[11px] font-semibold text-wa-dark dark:text-wa mb-0.5 hover:underline text-left"
              title="View contact"
            >
              {resolveName(m.participant || m.from) ?? senderName(m)}
            </button>
          )}
          {m.replyTo && (
            <QuoteView
              quote={m.replyTo as ReplyTo}
              resolveName={resolveName}
              myIds={myIds}
              onClick={() => onJump((m.replyTo as ReplyTo).id)}
              className="mb-1"
            />
          )}
          {m.hasMedia && (
            <div className="mb-1">
              <MediaView message={m} session={session} chatId={chatId} />
            </div>
          )}
          {m.location && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                void openUrl(`https://maps.google.com/?q=${m.location!.latitude},${m.location!.longitude}`);
              }}
              className="block text-xs underline text-sky-600 dark:text-sky-400"
            >
              📍 {(m.location as { title?: string }).title || "Location"} · {m.location.latitude}, {m.location.longitude}
            </a>
          )}
          {m.vCards?.map((v, i) => (
            <VCardView key={i} vcard={v} />
          ))}
          <PollView message={m} session={session} chatId={chatId} />
          {m.body && (
            <div className="break-words">
              <WaMarkdown text={m.body} mentions={resolveName} />
            </div>
          )}
          <TranslationView id={m.id} />
          <ImageNoteView id={m.id} />
          {m.body && !m.hasMedia && <LinkPreviewCard message={m} />}
          <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-300/70">
            {isEdited(m) && <span className="italic">edited</span>}
            {formatTime(m.timestamp)}
            {mine && <AckIcon ack={m.ack} />}
          </div>
        </div>
        {reactions.length > 0 && (
          <div className="-mt-2 mx-2 flex gap-1 z-10">
            {reactions.map((r) => (
              <span
                key={r.emoji}
                title={r.me ? "You reacted" : undefined}
                className={cn(
                  "rounded-full bg-white dark:bg-neutral-800 border px-1.5 py-px text-[12px] leading-4 shadow-sm",
                  r.me ? "border-wa-dark" : "border-neutral-200 dark:border-neutral-700",
                )}
              >
                {r.emoji}
                {r.count > 1 && <span className="ml-0.5 text-[10px] text-neutral-500">{r.count}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

function TranslationView({ id }: { id: string }) {
  const t = useTranslations((s) => s.byMsg[id]);
  const clear = useTranslations((s) => s.clear);
  if (!t) return null;
  return (
    <div className="mt-1 rounded-md border-l-2 border-sky-400 bg-sky-50/70 dark:bg-sky-900/20 px-2 py-1 text-xs">
      <div className="flex items-center gap-1 text-[10px] text-sky-700 dark:text-sky-300 mb-0.5">
        <Languages size={10} /> {langName(t.target)}
        <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => clear(id)} title="Hide translation">
          <X size={10} />
        </button>
      </div>
      {t.loading && (
        <span className="flex items-center gap-1 opacity-70">
          <Spinner size={10} className="animate-spin" /> translating…
        </span>
      )}
      {t.error && <span className="text-red-600 selectable">{t.error}</span>}
      {t.text && <div className="whitespace-pre-wrap break-words selectable">{t.text}</div>}
    </div>
  );
}

/** AI description / OCR result under an image bubble. */
function ImageNoteView({ id }: { id: string }) {
  const n = useImageNotes((s) => s.byMsg[id]);
  const clear = useImageNotes((s) => s.clear);
  if (!n) return null;
  return (
    <div className="mt-1 rounded-md border-l-2 border-violet-400 bg-violet-50/70 dark:bg-violet-900/20 px-2 py-1 text-xs">
      <div className="flex items-center gap-1 text-[10px] text-violet-700 dark:text-violet-300 mb-0.5">
        {n.kind === "ocr" ? <ScanText size={10} /> : <Sparkles size={10} />} {n.kind === "ocr" ? "Extracted text" : "Description"}
        {n.text && (
          <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => void navigator.clipboard.writeText(n.text!)} title="Copy">
            <Copy size={10} />
          </button>
        )}
        <button className={cn("opacity-60 hover:opacity-100", !n.text && "ml-auto")} onClick={() => clear(id)} title="Hide">
          <X size={10} />
        </button>
      </div>
      {n.loading && (
        <span className="flex items-center gap-1 opacity-70">
          <Spinner size={10} className="animate-spin" /> {n.kind === "ocr" ? "reading text…" : "looking at the image…"}
        </span>
      )}
      {n.error && <span className="text-red-600 selectable">{n.error}</span>}
      {n.text && <div className="whitespace-pre-wrap break-words selectable">{n.text}</div>}
    </div>
  );
}

export function VCardView({ vcard }: { vcard: string }) {
  const name = vcard.match(/^FN:(.*)$/m)?.[1] ?? "Contact";
  const tel = vcard.match(/^TEL[^:]*:(.*)$/m)?.[1] ?? "";
  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/5 dark:bg-white/10 px-3 py-2 my-1">
      <Avatar name={name} size={32} />
      <div className="min-w-0">
        <div className="font-medium truncate">{name}</div>
        <div className="text-xs opacity-70 selectable">{tel}</div>
      </div>
    </div>
  );
}

export function PollView({ message: m, session, chatId }: { message: WAMessage; session: string; chatId: string }) {
  const msg = (
    m._data as
      { Message?: Record<string, { name?: string; options?: { optionName: string }[]; selectableOptionsCount?: number }> } | undefined
  )?.Message;
  const poll = msg?.pollCreationMessageV3 ?? msg?.pollCreationMessage ?? msg?.pollCreationMessageV2;
  const votes = usePolls((s) => s.byPoll[bareId(m.id)]);
  const setOwn = usePolls((s) => s.setOwn);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!poll) return null;
  const multiple = poll.selectableOptionsCount === 0;
  const mine = votes?.me ?? [];
  const tally = new Map<string, number>();
  for (const opts of Object.values(votes ?? {})) for (const o of opts) tally.set(o, (tally.get(o) ?? 0) + 1);
  const total = Object.keys(votes ?? {}).length;

  const vote = async (option: string) => {
    const next = multiple
      ? mine.includes(option)
        ? mine.filter((x) => x !== option)
        : [...mine, option]
      : mine.includes(option)
        ? []
        : [option];
    setBusy(true);
    setErr(null);
    try {
      await requireClient().votePoll(session, chatId, m.id, next);
      setOwn(m.id, next);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-1 space-y-1 min-w-[200px]">
      <div className="font-medium">📊 {poll.name}</div>
      {poll.options?.map((o, i) => {
        const n = tally.get(o.optionName) ?? 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        const chosen = mine.includes(o.optionName);
        return (
          <button
            key={i}
            disabled={busy}
            onClick={() => vote(o.optionName)}
            className={cn(
              "relative w-full overflow-hidden rounded-md bg-black/5 dark:bg-white/10 px-2 py-1 text-xs text-left",
              chosen && "ring-1 ring-wa-dark",
            )}
          >
            <span className="absolute inset-y-0 left-0 bg-wa/30" style={{ width: `${pct}%` }} />
            <span className="relative flex items-center gap-1.5">
              <span className={cn("w-3 h-3 rounded-full border", chosen ? "bg-wa-dark border-wa-dark" : "border-neutral-400")} />
              <span className="flex-1">{o.optionName}</span>
              <span className="opacity-70">{n}</span>
            </span>
          </button>
        );
      })}
      <div className="text-[10px] opacity-60">
        {total} vote{total === 1 ? "" : "s"} · {multiple ? "multiple answers" : "single answer"} · counted from live events
      </div>
      {err && <div className="text-[10px] text-red-600 selectable">{err}</div>}
    </div>
  );
}

/** WhatsApp marks edits via Info.Edit ("1") or an editedMessage wrapper; our own edits set `edited`. */
export function isEdited(m: WAMessage & { edited?: boolean }) {
  if (m.edited) return true;
  const d = m._data as { Info?: { Edit?: string }; Message?: Record<string, unknown> } | undefined;
  return d?.Info?.Edit === "1" || !!d?.Message?.editedMessage;
}

export function AckIcon({ ack, className }: { ack: number; className?: string }) {
  if (ack <= 0) return <Clock size={12} className={className} />;
  if (ack === 1) return <Check size={12} className={className} />;
  if (ack === 2) return <CheckCheck size={12} className={className} />;
  return <CheckCheck size={12} className={cn("text-sky-500", className)} />;
}
