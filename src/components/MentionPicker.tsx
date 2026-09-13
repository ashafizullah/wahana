import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface MentionCandidate {
  /** id to send in `mentions` (phone form preferred) */
  id: string;
  phone: string;
  name: string;
}

/**
 * Popover listing group participants while typing "@…"; arrow keys + Enter/Tab pick.
 * Inserts "@<phone>" (what WhatsApp expects in the text) and reports the id for `mentions`.
 */
export function MentionPicker({ query, candidates, onPick, onClose }: { query: string; candidates: MentionCandidate[]; onPick: (c: MentionCandidate) => void; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const list = useMemo(() => {
    const t = query.toLowerCase();
    return candidates.filter((c) => !t || c.name.toLowerCase().includes(t) || c.phone.includes(t)).slice(0, 8);
  }, [candidates, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!list.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (i + 1) % list.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (i - 1 + list.length) % list.length); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); onPick(list[index]!); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list, index, onPick, onClose]);

  if (!list.length) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 z-30">
      {list.map((c, i) => (
        <button
          key={c.id}
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm", i === index ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60")}
        >
          <Avatar name={c.name} size={24} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{c.name}</span>
            <span className="block text-[10px] text-neutral-500">+{c.phone}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
