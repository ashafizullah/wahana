import { useEffect, useMemo, useState } from "react";
import { AtSign } from "lucide-react";
import { memberLabel, mentionDigits } from "@/lib/mentions";
import type { NativeGroupMember } from "@/lib/nativeWa";
import { cn } from "@/lib/utils";

/** Popover shown while the composer types "@…" in a group; Enter/Tab inserts the mention. */
export function MentionPicker({
  query,
  members,
  onPick,
  onClose,
}: {
  query: string;
  members: NativeGroupMember[];
  onPick: (member: NativeGroupMember) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const list = useMemo(() => {
    const t = query.trim().toLowerCase();
    const digits = t.replace(/\D/g, "");
    return members
      .filter((m) => {
        if (!t) return true;
        const name = (m.name ?? "").toLowerCase();
        const phone = mentionDigits(m.phone ?? "");
        return name.includes(t) || (digits.length > 0 && (mentionDigits(m.id).includes(digits) || phone.includes(digits)));
      })
      .slice(0, 8);
  }, [members, query]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!list.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => (i + 1) % list.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i - 1 + list.length) % list.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onPick(list[index]!);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list, index, onPick, onClose]);
  if (!list.length) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 w-80 max-h-72 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 z-30">
      {list.map((m, i) => {
        const label = memberLabel(m);
        return (
          <button
            key={m.id}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(m);
            }}
            className={cn(
              "w-full flex items-start gap-2 px-3 py-1.5 text-left text-sm",
              i === index ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
            )}
          >
            <AtSign size={14} className="text-wa-dark mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block font-medium truncate">{label}</span>
              {m.phone && m.phone !== label && <span className="block text-xs text-neutral-500 truncate">{m.phone}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
