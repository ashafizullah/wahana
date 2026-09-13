import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { listQuickReplies, expandTemplate } from "@/store/quickReplies";
import { useSettings } from "@/store/settings";
import { cn } from "@/lib/utils";

/** Popover shown while the composer starts with "/…"; Enter/Tab inserts the expanded template. */
export function QuickReplyPicker({ query, ctx, onPick, onClose }: { query: string; ctx: { name?: string; phone?: string }; onPick: (text: string) => void; onClose: () => void }) {
  const profile = useSettings((s) => s.activeProfile);
  const { data } = useQuery({ queryKey: ["quick-replies", profile], queryFn: () => listQuickReplies(profile), enabled: !!profile });
  const [index, setIndex] = useState(0);
  const list = useMemo(() => {
    const t = query.toLowerCase();
    return (data ?? []).filter((r) => !t || r.shortcut.startsWith(t) || r.text.toLowerCase().includes(t)).slice(0, 8);
  }, [data, query]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!list.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (i + 1) % list.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (i - 1 + list.length) % list.length); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); onPick(expandTemplate(list[index]!.text, ctx)); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list, index, onPick, onClose, ctx]);
  if (!list.length) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 w-96 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 z-30">
      {list.map((r, i) => (
        <button key={r.id} onMouseDown={(e) => { e.preventDefault(); onPick(expandTemplate(r.text, ctx)); }} className={cn("w-full flex items-start gap-2 px-3 py-1.5 text-left text-sm", i === index ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60")}>
          <Zap size={14} className="text-wa-dark mt-0.5 shrink-0" />
          <span className="min-w-0">
            <span className="block font-medium">/{r.shortcut}</span>
            <span className="block text-xs text-neutral-500 line-clamp-2">{r.text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
