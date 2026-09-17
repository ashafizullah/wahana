import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import data from "@emoji-mart/data";
import { Picker } from "emoji-mart";
import { Button } from "@/components/ui";
import { useDismiss, useLatest } from "@/lib/hooks";

/** Emoji button + popover picker (emoji-mart core, data bundled locally so it works offline). */
export function EmojiButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const onPickRef = useLatest(onPick);

  useEffect(() => {
    if (!open || !host.current) return;
    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const picker = new Picker({
      data,
      theme: dark ? "dark" : "light",
      previewPosition: "none",
      skinTonePosition: "search",
      maxFrequentRows: 2,
      perLine: 9,
      onEmojiSelect: (e: { native: string }) => onPickRef.current(e.native),
    }) as unknown as HTMLElement;
    const el = host.current;
    el.replaceChildren(picker);
    return () => el.replaceChildren();
  }, [open, onPickRef]);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} title="Emoji">
        <Smile size={18} />
      </Button>
      {open && <div ref={host} className="absolute bottom-full left-0 mb-2 z-30 shadow-2xl rounded-xl overflow-hidden" />}
    </div>
  );
}
