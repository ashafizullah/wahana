import { useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { MUTE_FOREVER, isMutedUntil } from "@/store/chatPrefs";
import { cn } from "@/lib/utils";

const HOUR = 3_600_000;
const DURATIONS: { label: string; ms: number | typeof MUTE_FOREVER }[] = [
  { label: "8 hours", ms: 8 * HOUR },
  { label: "1 week", ms: 7 * 24 * HOUR },
  { label: "Always", ms: MUTE_FOREVER },
];

/** "until 14:30" / "until Mon 3 Oct, 14:30" / "until you unmute". */
export function muteLabel(until: number | undefined) {
  if (!isMutedUntil(until)) return "";
  if (until === undefined || until <= 1) return "until you unmute";
  const d = new Date(until);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `until ${time}` : `until ${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/**
 * Mute / unmute row with a duration picker. `until` is the stored mute value; `onSet` gets an end
 * time (epoch ms), MUTE_FOREVER, or null to unmute. `className` styles the main row so it matches
 * the menu or panel it sits in.
 */
export function MuteControl({
  until,
  onSet,
  className,
}: {
  until: number | undefined;
  onSet: (until: number | null) => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const muted = isMutedUntil(until);
  if (muted) {
    return (
      <button className={className} onClick={() => onSet(null)}>
        <Bell size={13} className="shrink-0" />
        <span className="flex-1 text-left">
          Unmute notifications
          <span className="block text-[11px] text-neutral-500">Muted {muteLabel(until)}</span>
        </span>
      </button>
    );
  }
  return (
    <>
      <button className={className} onClick={() => setOpen((o) => !o)}>
        <BellOff size={13} className="shrink-0" />
        <span className="flex-1 text-left">Mute notifications…</span>
      </button>
      {open &&
        DURATIONS.map((d) => (
          <button
            key={d.label}
            className={cn(className, "pl-9 text-neutral-600 dark:text-neutral-300")}
            onClick={() => onSet(d.ms === MUTE_FOREVER ? MUTE_FOREVER : Date.now() + d.ms)}
          >
            {d.label}
          </button>
        ))}
    </>
  );
}
