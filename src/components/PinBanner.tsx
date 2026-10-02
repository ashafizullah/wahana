import { useState } from "react";
import { Loader2, Pin, X } from "lucide-react";
import { cn, errMsg } from "@/lib/utils";

/** Strip above a chat's message list showing the current pinned message: click to jump, × to unpin. */
export function PinBanner({
  count,
  index,
  who,
  text,
  onJump,
  onUnpin,
}: {
  count: number;
  index: number;
  /** Sender and text of the pinned message, when it is loaded. */
  who?: string;
  text?: string;
  onJump: () => void;
  onUnpin: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const unpin = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onUnpin();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shrink-0 flex items-center bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
      <button
        onClick={onJump}
        title={count > 1 ? `Pinned message ${index + 1} of ${count}. Click to go to it` : "Go to pinned message"}
        className="flex-1 min-w-0 flex items-center gap-2.5 px-4 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
      >
        {count > 1 && (
          <div className="flex flex-col gap-0.5 self-stretch py-0.5">
            {Array.from({ length: Math.min(count, 4) }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "w-0.5 flex-1 rounded-full",
                  i === Math.min(index, 3) ? "bg-wa-dark dark:bg-wa" : "bg-neutral-300 dark:bg-neutral-700",
                )}
              />
            ))}
          </div>
        )}
        <Pin size={14} className="shrink-0 text-neutral-500" />
        <div className="min-w-0 text-xs">
          <div className="font-medium text-wa-dark dark:text-wa">{count > 1 ? `Pinned message #${index + 1}` : "Pinned message"}</div>
          <div className={cn("truncate", err ? "text-red-600" : "text-neutral-600 dark:text-neutral-300")}>
            {err ?? (
              <>
                {who && <span className="font-medium">{who}: </span>}
                {text ?? "Not loaded yet. Scroll up to find it"}
              </>
            )}
          </div>
        </div>
      </button>
      <button
        onClick={() => void unpin()}
        disabled={busy}
        title="Unpin"
        className="shrink-0 mr-2 p-1.5 rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
      </button>
    </div>
  );
}
