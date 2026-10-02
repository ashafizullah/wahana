import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Eye,
  Forward,
  Languages,
  ListChecks,
  Loader2,
  Pencil,
  Pin,
  RefreshCw,
  Reply,
  ScanText,
  SmilePlus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui";
import {
  LANGUAGES,
  aiConfigured,
  analyzeImage,
  extractTasks,
  langName,
  smartReplies,
  summarizeChat,
  translate,
  type ExtractedTask,
} from "@/lib/ai";
import { nativeWa, type NativeMessage } from "@/lib/nativeWa";
import { cn, errMsg } from "@/lib/utils";
import { WaMarkdown } from "@/lib/waMarkdown";
import { useImageNotes, type ImageNoteKind } from "@/store/imageNotes";
import { bareId, useReactions } from "@/store/reactions";
import { nativeAccountKey } from "@/lib/account";
import { useSettings } from "@/store/settings";
import { useTranslations } from "@/store/translations";
import { nativeMediaBlob } from "@/screens/whatsapp/NativeMediaView";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * The WAHA chat screen's AI features, for native WhatsApp accounts: summary and task
 * extraction, suggested replies, message translation (on demand or automatic), and
 * describing / reading images. They share `lib/ai` with the WAHA screens; only the
 * message shape differs.
 */

const mediaLabel: Record<string, string> = {
  image: "[photo]",
  video: "[video]",
  audio: "[audio]",
  ptt: "[voice]",
  sticker: "[sticker]",
  document: "[document]",
};

/** Plain-text transcript (`[date time] Name: text`), oldest first, as the prompts expect. */
export function nativeTranscript(messages: NativeMessage[]) {
  return messages
    .map((m) => {
      const who = m.fromMe ? "You" : m.senderName || m.senderPhone || "Them";
      const media = m.media ? (m.media.kind === "document" ? `[document: ${m.media.fileName ?? ""}]` : mediaLabel[m.media.kind]) : "";
      return `[${new Date(m.timestamp).toLocaleString()}] ${who}: ${[media, m.body].filter(Boolean).join(" ")}`;
    })
    .join("\n");
}

const usable = (m: NativeMessage) => m.kind !== "unsupported" && (m.body || m.media);

// ── Translation ────────────────────────────────────────────────────────

export function translateMessage(m: NativeMessage, target: string) {
  const t = useTranslations.getState();
  t.set(m.id, { target, loading: true });
  translate(m.body, target, m.id)
    .then((text) => useTranslations.getState().set(m.id, { target, text }))
    .catch((e) => useTranslations.getState().set(m.id, { target, error: errMsg(e) }));
}

/** Translates the newest incoming messages into `target`, each once. */
export function useNativeAutoTranslate(messages: NativeMessage[], target: string | undefined) {
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!target || !aiConfigured()) return;
    const done = useTranslations.getState().byMsg;
    const todo = [...messages]
      .reverse()
      .filter((m) => !m.fromMe && m.body)
      .slice(0, 20)
      .filter((m) => !done[m.id] && !tried.current.has(`${target}:${m.id}`));
    for (const m of todo) {
      tried.current.add(`${target}:${m.id}`);
      translateMessage(m, target);
    }
  }, [messages, target]);
}

// ── Images ─────────────────────────────────────────────────────────────

export function analyzeMessageImage(accountId: string, m: NativeMessage, kind: ImageNoteKind) {
  const notes = useImageNotes.getState();
  notes.set(m.id, { kind, loading: true });
  (async () => {
    const blob = await nativeMediaBlob(accountId, m);
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    const mediaType = (m.media?.mimetype ?? "image/jpeg").split(";")[0]!;
    return analyzeImage({ data, mediaType }, kind, useSettings.getState().aiTranslateTo, m.body || undefined, nativeAccountKey(accountId));
  })()
    .then((text) => useImageNotes.getState().set(m.id, { kind, text }))
    .catch((e) => useImageNotes.getState().set(m.id, { kind, error: errMsg(e) }));
}

// ── Message menu ───────────────────────────────────────────────────────

/** Right-click menu on a bubble: react, reply, pin, forward, copy, translate, image tools, edit, delete. */
export function NativeMessageMenu({
  accountId,
  message: m,
  pos,
  pinned,
  readOnly,
  onSave,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onForward,
  onClose,
}: {
  accountId: string;
  message: NativeMessage;
  pos: { x: number; y: number };
  pinned?: boolean;
  /** A channel message: no reactions (newsletters use their own protocol). */
  readOnly?: boolean;
  onSave?: () => void;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
  onForward?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [langs, setLangs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const target = useSettings((s) => s.aiTranslateTo);
  const ready = aiConfigured();
  const isImage = m.media?.kind === "image" || m.media?.kind === "sticker";
  const myReaction = useReactions((s) => s.byMsg[bareId(m.id)]?.me);
  const [at, setAt] = useState({ left: pos.x, top: pos.y });

  // Keep the whole menu on screen: measure it and flip/shift it inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const left = pos.x + width + margin > window.innerWidth ? Math.max(margin, pos.x - width) : pos.x;
    const top = pos.y + height + margin > window.innerHeight ? Math.max(margin, window.innerHeight - height - margin) : pos.y;
    setAt({ left, top });
  }, [pos.x, pos.y, langs]);

  // Stays open while the reaction is sent, so a failure is shown here.
  const react = async (emoji: string) => {
    setBusy(emoji || "unreact");
    setErr(null);
    try {
      await nativeWa.react(accountId, m.chatId, m.id, emoji);
      useReactions.getState().set(m.id, "me", emoji);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(null);
    }
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const item = (icon: React.ReactNode, label: string, fn: () => void, disabled = false, danger = false) => (
    <button
      disabled={disabled}
      onClick={() => {
        onClose();
        fn();
      }}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent",
        danger && "text-red-600",
      )}
    >
      {icon} {label}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{ ...at, maxHeight: "calc(100vh - 16px)" }}
      className="fixed z-50 w-56 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!readOnly && (
        <div className="flex justify-between px-2 py-1.5 border-b border-neutral-100 dark:border-neutral-800">
          {QUICK_REACTIONS.map((r) => (
            <button
              key={r}
              disabled={busy !== null}
              // Picking your current reaction again takes it back, as in WhatsApp.
              onClick={() => void react(r === myReaction ? "" : r)}
              title={r === myReaction ? "Remove reaction" : undefined}
              className={cn(
                "text-lg rounded-full px-0.5 hover:scale-125 transition disabled:opacity-40",
                r === myReaction && "bg-neutral-200 dark:bg-neutral-700",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      )}
      {onReply && item(<Reply size={14} />, "Reply", onReply)}
      {onPin && item(<Pin size={14} />, pinned ? "Unpin" : "Pin (7 days)", onPin)}
      {onForward && item(<Forward size={14} />, "Forward…", onForward)}
      {m.body && item(<Copy size={14} />, "Copy text", () => void navigator.clipboard.writeText(m.body))}
      {m.body && (
        <>
          <button
            disabled={!ready}
            onClick={() => {
              onClose();
              translateMessage(m, target);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
            title={ready ? "" : "Set up AI in Settings to translate"}
          >
            <Languages size={14} /> Translate to {langName(target)}
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                setLangs((v) => !v);
              }}
              className="ml-auto text-xs text-neutral-500 hover:text-wa-dark"
              title="Other language"
            >
              ›
            </span>
          </button>
          {langs && (
            <div className="max-h-48 overflow-y-auto border-y border-neutral-100 dark:border-neutral-800">
              {LANGUAGES.map(([code, name]) => (
                <button
                  key={code}
                  onClick={() => {
                    onClose();
                    translateMessage(m, code);
                  }}
                  className={cn(
                    "w-full px-6 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800",
                    code === target && "font-semibold text-wa-dark",
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {isImage && item(<Eye size={14} />, "Describe image", () => analyzeMessageImage(accountId, m, "describe"), !ready)}
      {isImage && item(<ScanText size={14} />, "Extract text", () => analyzeMessageImage(accountId, m, "ocr"), !ready)}
      {m.media && onSave && item(<Download size={14} />, "Save file…", onSave)}
      {onEdit && item(<Pencil size={14} />, "Edit", onEdit)}
      {!readOnly && myReaction && (
        <button
          disabled={busy !== null}
          onClick={() => void react("")}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <SmilePlus size={14} /> Remove reaction {myReaction}
        </button>
      )}
      {onDelete && item(<Trash2 size={14} />, "Delete", onDelete, false, true)}
      {(busy || err) && (
        <div className="px-3 py-1.5 text-xs text-neutral-500 flex items-center gap-1 selectable">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <span className="text-red-600">{err}</span>}
        </div>
      )}
    </div>
  );
}

// ── Suggested replies ──────────────────────────────────────────────────

/** "Suggest replies" chip above the composer, shown when the last message is theirs. */
export function NativeSmartReplies({
  accountId,
  chatId,
  chatName,
  messages,
  onPick,
}: {
  accountId: string;
  chatId: string;
  chatName: string;
  messages: NativeMessage[];
  onPick: (text: string) => void;
}) {
  const [items, setItems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = messages[messages.length - 1];
  const lastId = last?.id;
  useEffect(() => {
    setItems(null);
    setErr(null);
  }, [chatId, lastId]);
  if (!aiConfigured() || !last || last.fromMe) return null;

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const recent = messages.filter(usable).slice(-30);
      setItems(
        await smartReplies(nativeTranscript(recent), {
          chatName,
          isGroup: chatId.endsWith("@g.us"),
          account: nativeAccountKey(accountId),
        }),
      );
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {items === null ? (
        <button
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-neutral-500 hover:text-wa-dark hover:border-wa-dark disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Suggest replies
        </button>
      ) : (
        <>
          {items.map((t, i) => (
            <button
              key={i}
              onClick={() => onPick(t)}
              title="Insert into composer"
              className="max-w-[320px] truncate rounded-full bg-wa/15 dark:bg-wa/20 px-3 py-1 text-left hover:bg-wa/30"
            >
              {t}
            </button>
          ))}
          <button onClick={run} disabled={busy} title="Regenerate" className="p-1 text-neutral-500 hover:text-wa-dark disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button
            onClick={() => setItems(null)}
            title="Dismiss"
            className="p-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            <X size={12} />
          </button>
        </>
      )}
      {err && <span className="text-red-600 selectable">{err}</span>}
    </div>
  );
}

// ── Summary and tasks ──────────────────────────────────────────────────

type Scope = "today" | "yesterday" | "50" | "100" | "300" | "all";

/** Remembered per chat while the app runs, so reopening shows the last answer. */
const lastSummary = new Map<string, { scope: Scope; question: string; count: number; text: string }>();
const lastTasks = new Map<string, ExtractedTask[]>();

export function NativeSummaryModal({
  accountId,
  chatKey,
  chatId,
  chatName,
  messages,
  canLoadOlder,
  onLoadOlder,
  onClose,
}: {
  accountId: string;
  /** Account and chat, for remembering the last result. */
  chatKey: string;
  chatId: string;
  chatName: string;
  messages: NativeMessage[];
  canLoadOlder: boolean;
  onLoadOlder: () => void;
  onClose: () => void;
}) {
  const prev = lastSummary.get(chatKey);
  const defaultLang = useSettings((s) => s.aiTranslateTo);
  const [scope, setScope] = useState<Scope>(prev?.scope ?? "100");
  const [question, setQuestion] = useState(prev?.question ?? "");
  const [lang, setLang] = useState(defaultLang);
  const [mode, setMode] = useState<"summary" | "tasks">("summary");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState(prev ?? null);
  const [tasks, setTasks] = useState<ExtractedTask[] | null>(lastTasks.get(chatKey) ?? null);
  const [copied, setCopied] = useState(false);
  const ready = aiConfigured();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scopes = useMemo(() => {
    const list = messages.filter(usable);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const since = (t: number) => list.filter((m) => m.timestamp >= t);
    return [
      { id: "today" as const, label: "Today", msgs: since(today) },
      { id: "yesterday" as const, label: "Since yesterday", msgs: since(today - 86_400_000) },
      { id: "50" as const, label: "Last 50", msgs: list.slice(-50) },
      { id: "100" as const, label: "Last 100", msgs: list.slice(-100) },
      { id: "300" as const, label: "Last 300", msgs: list.slice(-300) },
      { id: "all" as const, label: "All loaded", msgs: list },
    ];
  }, [messages]);
  const selected = scopes.find((s) => s.id === scope) ?? scopes[scopes.length - 1]!;

  const run = async () => {
    if (!selected.msgs.length) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === "summary") {
        const text = await summarizeChat(nativeTranscript(selected.msgs), {
          chatName,
          isGroup: chatId.endsWith("@g.us"),
          language: lang,
          question: question.trim() || undefined,
          account: nativeAccountKey(accountId),
        });
        const r = { scope, question: question.trim(), count: selected.msgs.length, text };
        lastSummary.set(chatKey, r);
        setResult(r);
      } else {
        const list = await extractTasks(nativeTranscript(selected.msgs), {
          chatName,
          language: lang,
          account: nativeAccountKey(accountId),
        });
        lastTasks.set(chatKey, list);
        setTasks(list);
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 grid place-items-center p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl max-h-full flex flex-col rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <Sparkles size={16} className="text-wa-dark" />
          <div className="flex-1 min-w-0 font-semibold truncate">{chatName}</div>
          <div className="flex rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5 text-xs">
            {(["summary", "tasks"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn("rounded-md px-2.5 py-1 capitalize", mode === m && "bg-white dark:bg-neutral-700 shadow-sm font-medium")}
              >
                {m}
              </button>
            ))}
          </div>
          <button onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-3 space-y-2 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((s) => (
              <button
                key={s.id}
                onClick={() => setScope(s.id)}
                disabled={!s.msgs.length}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs border transition disabled:opacity-40",
                  s.id === selected.id
                    ? "bg-wa-dark text-white border-wa-dark"
                    : "border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                )}
              >
                {s.label} <span className="opacity-70">({s.msgs.length})</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {mode === "summary" ? (
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && void run()}
                placeholder="Optional question, e.g. “What did they decide about the deadline?”"
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-wa-dark"
              />
            ) : (
              <span className="flex-1 text-xs text-neutral-500">Finds promises, deadlines, meetings and bills in the conversation.</span>
            )}
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-xs outline-none"
              title="Output language"
            >
              {LANGUAGES.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
            <Button onClick={run} disabled={!ready || busy || !selected.msgs.length} title={ready ? "" : "Set up AI in Settings first"}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : mode === "tasks" ? <ListChecks size={14} /> : <Sparkles size={14} />}
              {mode === "tasks" ? "Find tasks" : question.trim() ? "Ask" : "Summarize"}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            <span>Only loaded messages are included.</span>
            {canLoadOlder && (
              <button className="underline" onClick={onLoadOlder}>
                Load older
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 text-sm">
          {!ready && <p className="text-neutral-500">Set up an AI provider in Settings → AI to use this.</p>}
          {err && <p className="text-red-600 selectable">{err}</p>}
          {mode === "summary" && result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="flex-1">
                  {result.question ? `Answer from ${result.count} messages` : `Summary of ${result.count} messages`}
                </span>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(result.text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="flex items-center gap-1 hover:text-wa-dark"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} Copy
                </button>
              </div>
              <div className="whitespace-pre-wrap break-words selectable">
                <WaMarkdown text={result.text} />
              </div>
            </div>
          )}
          {mode === "tasks" &&
            tasks &&
            (tasks.length === 0 ? (
              <p className="text-neutral-500">No tasks found.</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t, i) => (
                  <li key={i} className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-neutral-500">
                      {[t.who, t.due ? new Date(t.due).toLocaleString() : "", t.detail].filter(Boolean).join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </div>
  );
}
