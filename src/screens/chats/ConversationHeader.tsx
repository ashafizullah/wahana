import { useState } from "react";
import { CalendarDays, CheckCheck, Download, Info, Languages, MoreVertical, Search, Sparkles } from "lucide-react";
import type { ChatOverview, ViewMessage } from "@/api/types";
import { confirm } from "@/components/Confirm";
import { Avatar, Button, MenuItem, Popover } from "@/components/ui";
import { aiConfigured, LANGUAGES } from "@/lib/ai";
import { exportChat, type ExportFormat } from "@/lib/exportChat";
import { cn, convKey, displayId, errMsg } from "@/lib/utils";
import type { MentionResolver } from "@/lib/waMarkdown";
import { useChatPrefs, type AutoTranslate } from "@/store/chatPrefs";
import { requireClient, useSettings } from "@/store/settings";

const EMPTY_AUTO: AutoTranslate = {};

export function ConversationHeader({
  session,
  chatId,
  chat,
  name,
  presenceText,
  ordered,
  resolveName,
  onToggleInfo,
  onToggleSearch,
  onSummary,
  onJumpToDate,
}: {
  session: string;
  chatId: string;
  chat: ChatOverview | undefined;
  name: string;
  presenceText: string | null | undefined;
  ordered: ViewMessage[];
  resolveName: MentionResolver;
  onToggleInfo: () => void;
  onToggleSearch: () => void;
  onSummary: () => void;
  onJumpToDate: (day: string) => Promise<void>;
}) {
  const readMode = useSettings((s) => s.readReceipts);
  const [datePick, setDatePick] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportAs = async (f: ExportFormat) => {
    setMoreOpen(false);
    setExporting(true);
    try {
      const p = await exportChat(
        name,
        ordered.filter((m) => !m.waiting),
        f,
        resolveName,
      );
      if (p) await confirm({ title: "Exported", message: p, confirmLabel: "OK" });
    } catch (e) {
      await confirm({ title: "Export failed", message: errMsg(e), confirmLabel: "OK" });
    } finally {
      setExporting(false);
    }
  };
  const live = presenceText?.includes("typing") || presenceText?.includes("recording");

  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-4 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
      {readMode === "manual" && <ReadReceiptButton session={session} chatId={chatId} ordered={ordered} />}
      <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={onToggleInfo} title="Chat info">
        <Avatar src={chat?.picture} name={name} size={36} />
        <div className="min-w-0">
          <div className="font-medium truncate">{name}</div>
          <div className={cn("text-xs truncate", live ? "text-wa-dark dark:text-wa" : "text-neutral-500")}>
            {presenceText ?? displayId(chatId)}
          </div>
        </div>
      </button>
      <Popover
        open={datePick}
        onClose={() => setDatePick(false)}
        align="right"
        className="p-3 space-y-2 w-56"
        trigger={
          <Button variant="ghost" size="sm" onClick={() => setDatePick((v) => !v)} title="Jump to date">
            <CalendarDays size={16} />
          </Button>
        }
      >
        <div className="text-xs font-medium">Jump to date</div>
        <input
          type="date"
          autoFocus
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => {
            if (!e.target.value) return;
            setDatePick(false);
            void onJumpToDate(e.target.value);
          }}
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm outline-none"
        />
        <div className="text-[11px] text-neutral-500">Shows messages up to the end of that day.</div>
      </Popover>
      {aiConfigured() && (
        <Button variant="ghost" size="sm" onClick={onSummary} title="Summarize with AI">
          <Sparkles size={16} />
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onToggleSearch} title="Search in chat (⌘F)">
        <Search size={16} />
      </Button>
      <Button variant="ghost" size="sm" onClick={onToggleInfo} title="Info">
        <Info size={16} />
      </Button>
      <Popover
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        align="right"
        className="w-56 py-1"
        trigger={
          <Button variant="ghost" size="sm" onClick={() => setMoreOpen((v) => !v)} title="More">
            <MoreVertical size={16} />
          </Button>
        }
      >
        <MenuItem
          onClick={() => {
            setMoreOpen(false);
            onSummary();
          }}
        >
          <Sparkles size={14} /> Summarize with AI
        </MenuItem>
        {aiConfigured() && <AutoTranslateSettings session={session} chatId={chatId} />}
        <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
        <div className="px-3 py-1 text-[11px] text-neutral-500">Export loaded messages ({ordered.length})</div>
        {(["txt", "html", "json"] as ExportFormat[]).map((f) => (
          <MenuItem key={f} disabled={exporting} onClick={() => void exportAs(f)}>
            <Download size={14} /> Export as .{f}
          </MenuItem>
        ))}
        <div className="px-3 py-1 text-[10px] text-neutral-400">Scroll up first to include older messages.</div>
      </Popover>
    </header>
  );
}

/** Manual read receipts: one click sends the blue ticks for the newest incoming message. */
function ReadReceiptButton({ session, chatId, ordered }: { session: string; chatId: string; ordered: ViewMessage[] }) {
  const [sentFor, setSentFor] = useState<string | null>(null); // id of the last incoming message we've acknowledged
  const lastIn = [...ordered].reverse().find((m) => !m.fromMe);
  const pending = !!lastIn && sentFor !== lastIn.id;
  return (
    <Button
      variant={pending ? "primary" : "ghost"}
      size="sm"
      title={pending ? "Send read receipt (blue ticks) for this chat" : "Read receipt already sent"}
      disabled={!pending}
      onClick={async () => {
        try {
          await requireClient().sendSeen(session, chatId);
          setSentFor(lastIn!.id);
        } catch (e) {
          await confirm({ title: "Couldn't send read receipt", message: errMsg(e), confirmLabel: "OK" });
        }
      }}
    >
      <CheckCheck size={16} className={pending ? "" : "text-sky-500"} />
    </Button>
  );
}

function AutoTranslateSettings({ session, chatId }: { session: string; chatId: string }) {
  const key = convKey(session, chatId);
  const autoTr = useChatPrefs((s) => s.autoTranslate[key] ?? EMPTY_AUTO);
  const setAutoTranslate = useChatPrefs((s) => s.setAutoTranslate);
  const select =
    "flex-1 min-w-0 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-1.5 py-0.5 text-xs outline-none";
  const options = LANGUAGES.map(([c, n]) => (
    <option key={c} value={c}>
      {n}
    </option>
  ));
  return (
    <div className="px-3 py-1.5 space-y-1.5">
      <div className="flex items-center gap-1 text-[11px] text-neutral-500">
        <Languages size={12} /> Auto-translate (this chat)
      </div>
      <label className="flex items-center gap-2 text-xs">
        <span className="w-24 shrink-0 text-neutral-500">Incoming →</span>
        <select value={autoTr.in ?? ""} onChange={(e) => setAutoTranslate(key, { in: e.target.value || undefined })} className={select}>
          <option value="">Off</option>
          {options}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <span className="w-24 shrink-0 text-neutral-500">My messages →</span>
        <select value={autoTr.out ?? ""} onChange={(e) => setAutoTranslate(key, { out: e.target.value || undefined })} className={select}>
          <option value="">Off (send as typed)</option>
          {options}
        </select>
      </label>
      <div className="text-[10px] text-neutral-400">
        Incoming: shown under each new message. Outgoing: your draft is translated right before sending.
      </div>
    </div>
  );
}
