import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { ViewMessage } from "@/api/types";
import { Button } from "@/components/ui";
import { formatTime } from "@/lib/utils";
import type { MentionResolver } from "@/lib/waMarkdown";
import { senderName } from "@/screens/chats/MessageBubble";

/** In-chat search over the loaded messages. Enter jumps to the newest match; Escape closes. */
export function MessageSearchBar({
  ordered,
  resolveName,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onJump,
  onClose,
}: {
  ordered: ViewMessage[];
  resolveName: MentionResolver;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const term = query.trim();

  const matches = useMemo(() => {
    const t = term.toLowerCase();
    if (!t) return [];
    return [...ordered]
      .reverse()
      .filter((m) => m.body?.toLowerCase().includes(t))
      .slice(0, 100);
  }, [ordered, term]);

  // ⌘/Ctrl+F while already open: refocus the field (the parent handles opening).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shrink-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 space-y-1">
      <div className="flex items-center gap-2">
        <Search size={14} className="text-neutral-400" />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && matches[0]) onJump(matches[0].id);
          }}
          placeholder="Search in loaded messages…"
          className="flex-1 bg-transparent text-sm outline-none"
        />
        <span className="text-[11px] text-neutral-500">{term ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : ""}</span>
        {hasMore && term && (
          <Button size="sm" variant="secondary" onClick={onLoadOlder} disabled={loadingOlder}>
            {loadingOlder ? <Loader2 size={12} className="animate-spin" /> : "Load older"}
          </Button>
        )}
        <button onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {term && matches.length > 0 && (
        <div className="max-h-40 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
          {matches.map((m) => (
            <button
              key={m.id}
              onClick={() => onJump(m.id)}
              className="w-full text-left px-1 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span className="text-neutral-400 mr-2">{formatTime(m.timestamp)}</span>
              <span className="font-medium mr-1">{m.fromMe ? "You" : (resolveName(m.participant || m.from) ?? senderName(m))}:</span>
              <span className="opacity-80">{m.body.slice(0, 120)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
