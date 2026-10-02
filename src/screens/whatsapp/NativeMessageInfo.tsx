import { useEffect, useState } from "react";
import { Check, CheckCheck, Loader2, X } from "lucide-react";
import { nativeWa, type NativeMessage, type NativeReceipt } from "@/lib/nativeWa";
import { cn, errMsg, isGroup } from "@/lib/utils";

const fmt = (ms: number) =>
  new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Sent, delivered, read and played times of a message I sent; per recipient in a group. */
export function NativeMessageInfo({
  accountId,
  message: m,
  onClose,
}: {
  accountId: string;
  message: NativeMessage;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<NativeReceipt[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const group = isGroup(m.chatId);

  useEffect(() => {
    nativeWa
      .messageInfo(accountId, m.id)
      .then(setRows)
      .catch((e) => setErr(errMsg(e)));
  }, [accountId, m.id]);

  const line = (icon: React.ReactNode, label: string, at: number | null | undefined, reached: boolean) => (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      {icon}
      <span className="flex-1">{label}</span>
      <span className={cn("text-xs", at ? "text-neutral-700 dark:text-neutral-200" : "text-neutral-400")}>
        {at ? fmt(at) : reached ? "time not recorded" : "—"}
      </span>
    </div>
  );
  const blue = <CheckCheck size={15} className="text-sky-500" />;
  const grey = <CheckCheck size={15} className="text-neutral-400" />;

  const first = (pick: (r: NativeReceipt) => number | null) => {
    const times = (rows ?? []).map(pick).filter((t): t is number => t != null);
    return times.length ? Math.min(...times) : null;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="w-full max-w-sm max-h-full flex flex-col rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex-1 font-semibold">Message info</div>
          <button onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-2">
          {m.body && <div className="rounded-lg bg-wa/10 px-3 py-2 text-sm line-clamp-3 mb-2 selectable">{m.body}</div>}
          {line(<Check size={15} className="text-neutral-400" />, "Sent", m.timestamp, true)}
          {!rows && !err && <Loader2 size={16} className="animate-spin text-neutral-400 my-2" />}
          {err && <div className="text-xs text-red-600 py-2 selectable">{err}</div>}
          {rows && !group && (
            <>
              {line(grey, "Delivered", first((r) => r.deliveredAt), m.ack >= 2)}
              {line(blue, "Read", first((r) => r.readAt), m.ack >= 3)}
              {m.media?.kind === "audio" && line(blue, "Played", first((r) => r.playedAt), m.ack >= 4)}
            </>
          )}
          {rows && group && (
            <>
              <Section title="Read by" rows={rows.filter((r) => r.readAt)} at={(r) => r.readAt} icon={blue} />
              <Section
                title="Delivered to"
                rows={rows.filter((r) => r.deliveredAt && !r.readAt)}
                at={(r) => r.deliveredAt}
                icon={grey}
              />
              {rows.length === 0 && (
                <div className="py-2 text-xs text-neutral-500">
                  {m.ack >= 2 ? "Per-person times were not recorded for this message." : "No receipts yet."}
                </div>
              )}
              <div className="py-2 text-[11px] text-neutral-400">
                WhatsApp only reports a read when that person has read receipts on.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  rows,
  at,
  icon,
}: {
  title: string;
  rows: NativeReceipt[];
  at: (r: NativeReceipt) => number | null;
  icon: React.ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 border-t border-neutral-100 dark:border-neutral-800 pt-2">
      <div className="text-xs font-medium text-neutral-500 mb-1">
        {title} ({rows.length})
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 py-1 text-sm">
          {icon}
          <span className="flex-1 truncate">{r.name}</span>
          <span className="text-xs text-neutral-500">{at(r) ? fmt(at(r)!) : ""}</span>
        </div>
      ))}
    </div>
  );
}
