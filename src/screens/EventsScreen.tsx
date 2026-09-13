import { useMemo, useState } from "react";
import { Pause, Play, Trash2, Copy } from "lucide-react";
import { useEventLog, type LogEntry } from "@/store/eventLog";
import { Button, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { WAMessage } from "@/api/types";

const TONES: Record<string, "green" | "amber" | "red" | "neutral" | "blue"> = {
  "message.any": "green",
  "message.ack": "blue",
  "session.status": "amber",
  "presence.update": "neutral",
};

function summary(e: LogEntry["event"]) {
  const p = e.payload as Partial<WAMessage> & { name?: string; status?: string; id?: string; ackName?: string; presences?: unknown[] };
  switch (e.event) {
    case "message.any":
      return `${p.fromMe ? "→" : "←"} ${p.from} ${p.body ? `“${p.body.slice(0, 60)}”` : p.hasMedia ? "[media]" : ""}`;
    case "message.ack":
      return `${p.ackName} ${p.id?.slice(-12)}`;
    case "session.status":
      return `${p.name} → ${p.status}`;
    case "presence.update":
      return `${p.id} (${p.presences?.length ?? 0})`;
    default:
      return JSON.stringify(p).slice(0, 80);
  }
}

/** Live view of everything arriving on the WebSocket — handy when debugging webhooks. */
export function EventsScreen() {
  const { entries, paused, setPaused, clear } = useEventLog();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const list = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return t ? entries.filter((x) => x.event.event.includes(t) || x.event.session.includes(t) || JSON.stringify(x.event.payload).toLowerCase().includes(t)) : entries;
  }, [entries, filter]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-4 h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <h1 className="font-semibold">Events</h1>
        <span className="text-xs text-neutral-500">{entries.length} buffered</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter (event, session, payload)"
          className="ml-4 flex-1 max-w-md rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 text-sm outline-none"
        />
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => setPaused(!paused)}>
          {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? "Resume" : "Pause"}
        </Button>
        <Button size="sm" variant="ghost" onClick={clear} title="Clear"><Trash2 size={14} /></Button>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {list.length === 0 && <p className="p-6 text-neutral-500 font-sans text-sm">Waiting for events… Anything WAHA sends over the WebSocket will show up here.</p>}
        {list.map((x) => (
          <div key={x.seq} className="border-b border-neutral-100 dark:border-neutral-800">
            <button
              onClick={() => setOpen(open === x.seq ? null : x.seq)}
              className={cn("w-full flex items-center gap-3 px-4 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900", open === x.seq && "bg-neutral-50 dark:bg-neutral-900")}
            >
              <span className="text-neutral-400 shrink-0">{new Date(x.at).toLocaleTimeString([], { hour12: false })}</span>
              <Badge tone={TONES[x.event.event] ?? "neutral"}>{x.event.event}</Badge>
              <span className="text-neutral-500 shrink-0">{x.event.session}</span>
              <span className="truncate">{summary(x.event)}</span>
            </button>
            {open === x.seq && (
              <div className="relative bg-neutral-50 dark:bg-neutral-950 px-4 py-2">
                <button
                  className="absolute right-3 top-2 text-neutral-400 hover:text-neutral-700"
                  title="Copy JSON"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(x.event, null, 2))}
                >
                  <Copy size={14} />
                </button>
                <pre className="whitespace-pre-wrap break-all selectable max-h-96 overflow-auto">{JSON.stringify(x.event, null, 2)}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
