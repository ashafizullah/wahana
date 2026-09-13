import { useMemo, useState } from "react";
import { X, Check, CheckCheck, Send, Info, ChevronDown, ChevronRight } from "lucide-react";
import type { WAMessage } from "@/api/types";
import { useReceipts } from "@/store/receipts";
import { bareId } from "@/store/reactions";
import { Avatar } from "@/components/ui";
import type { MentionResolver } from "@/lib/waMarkdown";
import { cn, isGroup } from "@/lib/utils";
import { mediaKind } from "@/store/settings";

const fmt = (ms: number) => new Date(ms).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function MessageInfoModal({
  message: m,
  chatId,
  resolveName,
  onClose,
}: {
  message: WAMessage;
  chatId: string;
  resolveName: MentionResolver;
  onClose: () => void;
}) {
  const receipt = useReceipts((s) => s.byMsg[bareId(m.id)]);
  const [raw, setRaw] = useState(false);
  const group = isGroup(chatId);
  const info = (m._data as { Info?: { Type?: string; MediaType?: string; PushName?: string; Edit?: string; IsFromMe?: boolean } ; Message?: Record<string, { contextInfo?: { isForwarded?: boolean; forwardingScore?: number }; fileLength?: number | string; mimetype?: string; seconds?: number }> } | undefined);
  const inner = info?.Message ? Object.values(info.Message).find((v) => v && typeof v === "object") : undefined;
  const forwarded = !!inner?.contextInfo?.isForwarded;

  const steps = useMemo(() => {
    const lv = receipt?.levels ?? {};
    const rows: { label: string; at?: number; icon: typeof Check; reached: boolean; tone?: string }[] = [
      { label: "Sent", at: m.timestamp * 1000, icon: Send, reached: m.ack >= 1 || !m.fromMe },
    ];
    if (m.fromMe) {
      rows.push({ label: "Delivered", at: lv[2], icon: CheckCheck, reached: m.ack >= 2 });
      rows.push({ label: "Read", at: lv[3], icon: CheckCheck, reached: m.ack >= 3, tone: "text-sky-500" });
      if (mediaKind(m) === "audio" || m.ack >= 4) rows.push({ label: "Played", at: lv[4], icon: CheckCheck, reached: m.ack >= 4, tone: "text-sky-500" });
    }
    return rows;
  }, [m, receipt]);

  const participants = Object.entries(receipt?.participants ?? {}).sort((a, b) => b[1].ack - a[1].ack || b[1].at - a[1].at);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[460px] max-h-[80vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Info size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1">Message info</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-3 text-xs selectable line-clamp-4 break-words">
            {m.body || (m.hasMedia ? `[${mediaKind(m)}]` : "[no text]")}
          </div>

          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s.label} className={cn("flex items-center gap-3", !s.reached && "opacity-40")}>
                <s.icon size={16} className={s.reached ? (s.tone ?? "text-neutral-600 dark:text-neutral-300") : ""} />
                <span className="w-20 font-medium">{s.label}</span>
                <span className="text-neutral-600 dark:text-neutral-300 selectable">
                  {s.at ? fmt(s.at) : s.reached ? "time not recorded" : "—"}
                </span>
              </li>
            ))}
          </ul>
          {m.fromMe && m.ack >= 2 && !receipt?.levels[2] && (
            <p className="text-[11px] text-neutral-500">
              Delivery/read times are captured live from WhatsApp events; for messages sent before Wahana was running only the status is known.
            </p>
          )}

          {group && m.fromMe && participants.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-neutral-500 mb-1">Per participant</div>
              <ul className="space-y-1">
                {participants.map(([p, r]) => {
                  const name = resolveName(`${p}@lid`) ?? resolveName(`${p}@c.us`) ?? `+${p}`;
                  return (
                    <li key={p} className="flex items-center gap-2 text-xs">
                      <Avatar name={name} size={22} />
                      <span className="flex-1 truncate selectable">{name}</span>
                      <span className={cn("flex items-center gap-1", r.ack >= 3 ? "text-sky-500" : "text-neutral-500")}>
                        {r.ack >= 3 ? <CheckCheck size={12} /> : r.ack >= 2 ? <CheckCheck size={12} /> : <Check size={12} />}
                        {r.ack >= 4 ? "played" : r.ack >= 3 ? "read" : r.ack >= 2 ? "delivered" : "sent"} · {fmt(r.at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-neutral-500">Status</dt><dd className="selectable">{m.ackName ?? m.ack}</dd>
            <dt className="text-neutral-500">From</dt><dd className="selectable">{m.fromMe ? "You" : (resolveName(m.participant || m.from) ?? m.from)}{info?.Info?.PushName ? ` (~${info.Info.PushName})` : ""}</dd>
            <dt className="text-neutral-500">Type</dt><dd className="selectable">{info?.Info?.MediaType || info?.Info?.Type || (m.hasMedia ? mediaKind(m) : "text")}{forwarded ? " · forwarded" : ""}{info?.Info?.Edit ? ` · ${info.Info.Edit.toLowerCase()}` : ""}</dd>
            {m.hasMedia && (
              <>
                <dt className="text-neutral-500">Media</dt>
                <dd className="selectable">
                  {m.media?.mimetype}
                  {inner?.fileLength ? ` · ${(Number(inner.fileLength) / 1024).toFixed(0)} KB` : ""}
                  {inner?.seconds ? ` · ${inner.seconds}s` : ""}
                </dd>
              </>
            )}
            <dt className="text-neutral-500">Message ID</dt><dd className="selectable break-all font-mono text-[10px]">{m.id}</dd>
          </dl>

          <button onClick={() => setRaw((v) => !v)} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800">
            {raw ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Raw data
          </button>
          {raw && (
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all rounded-lg bg-neutral-50 dark:bg-neutral-950 p-2 max-h-72 overflow-auto selectable">
              {JSON.stringify(m, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

