import { Mic } from "lucide-react";

/** Incoming-side bubble with bouncing dots while the other side types (or records). */
export function TypingBubble({ who, recording }: { who?: string; recording?: boolean }) {
  return (
    <div className="flex justify-start pb-1" aria-live="polite">
      <div className="rounded-lg px-3 py-2 bg-white dark:bg-neutral-800 shadow-sm">
        {who && <div className="text-[11px] font-medium text-wa-dark dark:text-wa mb-0.5">{who}</div>}
        {recording ? (
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <Mic size={14} className="text-red-500 animate-pulse" /> recording audio…
          </div>
        ) : (
          <div className="flex items-center gap-1 h-4" title="typing…">
            {[0, 150, 300].map((delay) => (
              <span key={delay} className="size-1.5 rounded-full bg-neutral-400 animate-bounce" style={{ animationDelay: `${delay}ms` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
