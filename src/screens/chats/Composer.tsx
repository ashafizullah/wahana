import { useEffect, useMemo, useRef, useState } from "react";
import { useChats, useSendText, qk } from "@/api/queries";
import { requireClient, useSettings } from "@/store/settings";
import { Button, MenuItem, Popover } from "@/components/ui";
import { AttachMenu, VoiceRecorder, LocationDialog, ContactDialog, PollDialog, type AttachKind } from "@/components/AttachMenu";
import { QuoteView } from "@/components/QuoteView";
import { EmojiButton } from "@/components/EmojiPicker";
import { useDrafts } from "@/store/drafts";
import { MentionPicker, type MentionCandidate } from "@/components/MentionPicker";
import { QuickReplyPicker } from "@/components/QuickReplyPicker";
import { useGroupInfo } from "@/realtime/useNames";
import { useChatPrefs } from "@/store/chatPrefs";
import { Languages, Loader2, Loader2 as Spinner, RefreshCw, Send, Sparkles, Undo2, WandSparkles, X } from "lucide-react";
import { aiConfigured, translate, langName, rewriteDraft, smartReplies, REWRITE_MODES, type RewriteMode } from "@/lib/ai";
import { transcript } from "@/lib/exportChat";
import type { MentionResolver } from "@/lib/waMarkdown";
import type { ViewMessage, WAMessage } from "@/api/types";
import { cn, displayId, fileToBase64, isGroup, errMsg, convKey } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";


export function TranslateDraftButton({ text, onResult }: { text: string; onResult: (t: string) => void }) {
  const target = useSettings((s) => s.aiComposeTo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = aiConfigured();
  return (
    <div className="relative">
      <Button
        variant="ghost"
        disabled={!text.trim() || busy || !ready}
        title={ready ? `Translate draft to ${langName(target)} (⌘⇧T)` : "Set up AI in Settings to translate"}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            onResult(await translate(text, target));
          } catch (e) {
            setErr(errMsg(e));
            setTimeout(() => setErr(null), 4000);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner size={18} className="animate-spin" /> : <Languages size={18} />}
      </Button>
      {err && <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg bg-red-600 text-white text-xs px-2 py-1 shadow z-30 selectable">{err}</div>}
    </div>
  );
}

/** ✨ menu in the composer: rewrite the draft (fix / formal / casual / …) with one-step undo. */
export function WriteAssistButton({ text, onResult }: { text: string; onResult: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<RewriteMode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const ready = aiConfigured();
  useEffect(() => { if (!text) setUndo(null); }, [text]); // draft sent or cleared → nothing to undo
  const run = async (mode: RewriteMode) => {
    setOpen(false);
    setBusy(mode);
    setErr(null);
    try {
      const before = text;
      const out = await rewriteDraft(text, mode);
      if (out) { setUndo(before); onResult(out); }
    } catch (e) {
      setErr(errMsg(e));
      setTimeout(() => setErr(null), 4000);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        side="top"
        className="w-52 py-1"
        trigger={
          <Button
            variant="ghost"
            disabled={(!text.trim() && !undo) || !!busy || !ready}
            title={ready ? "Writing assistant" : "Set up AI in Settings to use the writing assistant"}
            onClick={() => setOpen((v) => !v)}
          >
            {busy ? <Spinner size={18} className="animate-spin" /> : <WandSparkles size={18} />}
          </Button>
        }
      >
        {undo && (
          <>
            <MenuItem onClick={() => { onResult(undo); setUndo(null); setOpen(false); }}>
              <Undo2 size={14} /> Undo last rewrite
            </MenuItem>
            <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          </>
        )}
        {REWRITE_MODES.map(([id, label]) => (
          <MenuItem key={id} disabled={!text.trim()} onClick={() => void run(id)}>
            {label}
          </MenuItem>
        ))}
      </Popover>
      {err && <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg bg-red-600 text-white text-xs px-2 py-1 shadow z-30 selectable">{err}</div>}
    </div>
  );
}

/** Suggested replies above the composer. Manual trigger (one request per click); cleared when a new message arrives. */
export function SmartReplies({ chatId, chatName, recent, resolveName, onPick }: { chatId: string; chatName: string; recent: WAMessage[]; resolveName: MentionResolver; onPick: (t: string) => void }) {
  const [items, setItems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = recent[recent.length - 1];
  const lastId = last?.id;
  useEffect(() => { setItems(null); setErr(null); }, [chatId, lastId]);
  if (!aiConfigured() || !last || last.fromMe) return null;
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const usable = recent.filter((m) => !(m as ViewMessage).waiting && (m.body || m.hasMedia));
      setItems(await smartReplies(transcript(usable, resolveName), { chatName, isGroup: isGroup(chatId) }));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {items === null ? (
        <button onClick={run} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-neutral-500 hover:text-wa-dark hover:border-wa-dark disabled:opacity-50">
          {busy ? <Spinner size={12} className="animate-spin" /> : <Sparkles size={12} />} Suggest replies
        </button>
      ) : (
        <>
          {items.map((t, i) => (
            <button key={i} onClick={() => onPick(t)} title="Insert into composer" className="max-w-[320px] truncate rounded-full bg-wa/15 dark:bg-wa/20 px-3 py-1 text-left hover:bg-wa/30">
              {t}
            </button>
          ))}
          <button onClick={run} disabled={busy} title="Regenerate" className="p-1 text-neutral-500 hover:text-wa-dark disabled:opacity-50">
            {busy ? <Spinner size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button onClick={() => setItems(null)} title="Dismiss" className="p-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"><X size={12} /></button>
        </>
      )}
      {err && <span className="text-red-600 selectable">{err}</span>}
    </div>
  );
}



export function Composer({
  session,
  chatId,
  replyTo,
  onClearReply,
  editing,
  onClearEdit,
  resolveName,
  myIds,
  onEditLast,
  recent,
}: {
  session: string;
  chatId: string;
  replyTo: WAMessage | null;
  onClearReply: () => void;
  editing: WAMessage | null;
  onClearEdit: () => void;
  resolveName: MentionResolver;
  myIds: string[];
  onEditLast: () => void;
  /** Newest loaded messages (oldest first) for reply suggestions. */
  recent: WAMessage[];
}) {
  const draftKey = convKey(session, chatId);
  const setDraft = useDrafts((s) => s.set);
  const [text, setTextRaw] = useState(() => useDrafts.getState().drafts[draftKey] ?? "");
  const setText = (v: string) => {
    setTextRaw(v);
    setDraft(draftKey, v);
  };
  const [uploading, setUploading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const autoOut = useChatPrefs((s) => s.autoTranslate[convKey(session, chatId)]?.out); // NB: chatPrefs keys are session:chatId
  const [dialog, setDialog] = useState<AttachKind | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [slash, setSlash] = useState<string | null>(null); // "/query" at the start of the composer
  const { data: chatsForCtx } = useChats(session);
  const chatCtx = useMemo(() => {
    const c = chatsForCtx?.find((x) => x.id === chatId);
    return { name: c?.name ?? displayId(chatId), phone: chatId.endsWith("@c.us") ? `+${chatId.split("@")[0]}` : "" };
  }, [chatsForCtx, chatId]);
  const mentionIds = useRef<Map<string, string>>(new Map()); // "@phone" in text → id
  const { data: groupInfo } = useGroupInfo(session, chatId);
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (!isGroup(chatId)) return [];
    return (groupInfo?.Participants ?? [])
      .map((p) => {
        const phone = p.PhoneNumber?.split("@")[0] ?? "";
        if (!phone) return null;
        return { id: `${phone}@c.us`, phone, name: resolveName(p.JID) ?? resolveName(`${phone}@c.us`) ?? p.DisplayName ?? `+${phone}` };
      })
      .filter((x): x is MentionCandidate => !!x)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groupInfo, chatId, resolveName]);

  const chipTable = useMemo(() => new Map(mentionCandidates.map((c) => [c.phone, c])), [mentionCandidates]);
  const draggingRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [fileAccept, setFileAccept] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const send = useSendText(session, chatId);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, [chatId, replyTo, editing]);

  useEffect(() => {
    if (editing) setText(editing.body);
  }, [editing]);

  // Typing presence: fire startTyping at most every 4s while typing, stopTyping after 5s idle.
  const typingRef = useRef<{ last: number; timer?: ReturnType<typeof setTimeout> }>({ last: 0 });
  const stopTyping = () => {
    clearTimeout(typingRef.current.timer);
    if (typingRef.current.last) {
      typingRef.current.last = 0;
      requireClient().stopTyping(session, chatId).catch(() => {});
    }
  };
  const noteTyping = () => {
    if (!useSettings.getState().sendTyping) return;
    const now = Date.now();
    if (now - typingRef.current.last > 4000) {
      typingRef.current.last = now;
      requireClient().startTyping(session, chatId).catch(() => {});
    }
    clearTimeout(typingRef.current.timer);
    typingRef.current.timer = setTimeout(stopTyping, 5000);
  };
  useEffect(() => stopTyping, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setErr(null);
    stopTyping();
    if (editing) {
      try {
        await requireClient().editMessage(session, chatId, editing.id, t);
        qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) =>
          old?.map((m) => (m.id === editing.id ? { ...m, body: t, edited: true } : m)),
        );
        setText("");
        onClearEdit();
      } catch (e) {
        setErr(errMsg(e));
      }
      return;
    }
    setText("");
    try {
      receiptBeforeSend();
      let out = t;
      if (autoOut && aiConfigured()) {
        setTranslating(true);
        try {
          out = (await translate(t, autoOut)) || t;
        } finally {
          setTranslating(false);
        }
      }
      const mentions = [...out.matchAll(/@(\d{6,20})/g)].map((x) => chipTable.get(x[1]!)?.id ?? mentionIds.current.get(x[1]!)).filter((x): x is string => !!x);
      await send.mutateAsync({ text: out, replyTo: replyTo?.id, mentions: [...new Set(mentions)] });
      onClearReply();
    } catch (e) {
      setErr(errMsg(e));
      setText(t);
    }
  };

  /** "Mark as read only when I reply": send the receipt right before our message goes out. */
  const receiptBeforeSend = () => {
    if (useSettings.getState().readReceipts === "on-reply") requireClient().sendSeen(session, chatId).catch(() => {});
  };

  /** Put a freshly sent message into the cache and refresh the chat list. */
  const appendSent = (msg: WAMessage) => {
    receiptBeforeSend();
    qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => (old ? [msg, ...old] : old));
    qc.invalidateQueries({ queryKey: qk.chats(session) });
  };

  const attach = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      receiptBeforeSend();
      const c = requireClient();
      const data = await fileToBase64(file);
      const payload = { mimetype: file.type || "application/octet-stream", filename: file.name, data };
      const caption = text.trim() || undefined;
      const msg = file.type.startsWith("image/")
        ? await c.sendImage(session, chatId, payload, caption)
        : file.type.startsWith("video/")
          ? await c.sendVideo(session, chatId, payload, caption)
          : await c.sendFile(session, chatId, payload, caption);
      setText("");
      appendSent(msg);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const pick = (k: AttachKind) => {
    if (k === "image" || k === "file") {
      setFileAccept(k === "image" ? "image/*,video/*" : undefined);
      // Let React apply `accept` before opening the native picker.
      setTimeout(() => fileRef.current?.click(), 0);
      return;
    }
    setDialog(k);
  };

  const blobToBase64 = (b: Blob) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res((r.result as string).split(",")[1]!);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(b);
    });

  return (
    <div
      className={cn("relative shrink-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 p-3 space-y-2", dragging && "ring-2 ring-inset ring-wa-dark")}
      onDragEnter={(e) => { e.preventDefault(); draggingRef.current++; setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={() => { draggingRef.current--; if (draggingRef.current <= 0) { draggingRef.current = 0; setDragging(false); } }}
      onDrop={(e) => {
        e.preventDefault();
        draggingRef.current = 0;
        setDragging(false);
        const f = [...e.dataTransfer.files][0];
        if (f) void attach(f);
      }}
    >
      {dragging && <div className="absolute inset-0 grid place-items-center bg-white/80 dark:bg-neutral-900/80 text-sm font-medium text-wa-dark z-10 pointer-events-none">Drop to send</div>}
      {slash !== null && (
        <QuickReplyPicker
          query={slash}
          ctx={chatCtx}
          onClose={() => setSlash(null)}
          onPick={(t) => {
            setText(t);
            setSlash(null);
            requestAnimationFrame(() => taRef.current?.focus());
          }}
        />
      )}
      {mention && (
        <MentionPicker
          query={mention.query}
          candidates={mentionCandidates}
          onClose={() => setMention(null)}
          onPick={(c) => {
            const before = text.slice(0, mention.start);
            const after = text.slice(mention.start + 1 + mention.query.length);
            const inserted = `@${c.phone} `;
            mentionIds.current.set(c.phone, c.id);
            setText(before + inserted + after);
            setMention(null);
            requestAnimationFrame(() => {
              const ta = taRef.current;
              if (!ta) return;
              ta.focus();
              ta.selectionStart = ta.selectionEnd = before.length + inserted.length;
            });
          }}
        />
      )}
      {!editing && !text.trim() && (
        <SmartReplies chatId={chatId} chatName={chatCtx.name} recent={recent} resolveName={resolveName} onPick={(t) => { setText(t); requestAnimationFrame(() => taRef.current?.focus()); }} />
      )}
      {editing && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 text-xs">
          <span className="font-semibold text-amber-700 dark:text-amber-300">Editing message</span>
          <span className="truncate flex-1 opacity-80">{editing.body}</span>
          <button onClick={() => { onClearEdit(); setText(""); }}>
            <X size={14} />
          </button>
        </div>
      )}
      {replyTo && !editing && (
        <div className="flex items-center gap-2">
          <QuoteView quote={replyTo} resolveName={resolveName} myIds={myIds} className="flex-1" />
          <button onClick={onClearReply} title="Cancel reply">
            <X size={14} />
          </button>
        </div>
      )}
      {err && <div className="text-xs text-red-600 selectable">{err}</div>}
      {dialog === "voice" && (
        <VoiceRecorder
          onClose={() => setDialog(null)}
          onSend={async (blob, mime) => {
            const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
            appendSent(await requireClient().sendVoice(session, chatId, { mimetype: mime.split(";")[0]!, filename: `voice.${ext}`, data: await blobToBase64(blob) }));
          }}
        />
      )}
      {dialog === "location" && (
        <LocationDialog
          onClose={() => setDialog(null)}
          onSend={async (lat, lng, title) => appendSent(await requireClient().sendLocation(session, chatId, lat, lng, title))}
        />
      )}
      {dialog === "contact" && (
        <ContactDialog
          onClose={() => setDialog(null)}
          onSend={async (name, phone, org) => appendSent(await requireClient().sendContactVcard(session, chatId, [{ fullName: name, phoneNumber: phone, organization: org || undefined }]))}
        />
      )}
      {dialog === "poll" && (
        <PollDialog
          onClose={() => setDialog(null)}
          onSend={async (name, options, multiple) => appendSent(await requireClient().sendPoll(session, chatId, name, options, multiple))}
        />
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={fileAccept}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void attach(f);
          }}
        />
        <AttachMenu disabled={uploading} onPick={pick} />
        <TranslateDraftButton text={text} onResult={(t) => setText(t)} />
        <WriteAssistButton text={text} onResult={(t) => setText(t)} />
        <EmojiButton
          onPick={(emoji) => {
            const ta = taRef.current;
            const start = ta?.selectionStart ?? text.length;
            const end = ta?.selectionEnd ?? text.length;
            const next = text.slice(0, start) + emoji + text.slice(end);
            setText(next);
            requestAnimationFrame(() => {
              if (!ta) return;
              ta.focus();
              ta.selectionStart = ta.selectionEnd = start + emoji.length;
            });
          }}
        />
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (v) noteTyping();
            // "@query" right before the caret → open the mention picker (groups only)
            const caret = e.target.selectionStart ?? v.length;
            const before = v.slice(0, caret);
            const m = before.match(/(?:^|\s)@([^\s@]*)$/);
            setMention(m && mentionCandidates.length ? { start: caret - m[1]!.length - 1, query: m[1]! } : null);
            const sl = v.match(/^\/(\S*)$/);
            setSlash(sl ? sl[1]! : null);
          }}
          onPaste={(e) => {
            const f = [...e.clipboardData.files][0];
            if (f) {
              e.preventDefault();
              void attach(f);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape" && editing) {
              onClearEdit();
              setText("");
            }
            if (e.key === "ArrowUp" && !text && !editing) {
              e.preventDefault();
              onEditLast();
            }
          }}
          rows={1}
          placeholder="Type a message (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-sm outline-none max-h-40"
          style={{ height: "auto" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 160) + "px";
          }}
        />
        <Button onClick={submit} disabled={!text.trim() || send.isPending || translating} title={autoOut ? `Send (translated to ${langName(autoOut)})` : "Send"}>
          {send.isPending || translating ? <Loader2 size={16} className="animate-spin" /> : autoOut ? <Languages size={16} /> : <Send size={16} />}
        </Button>
      </div>
    </div>
  );
}
