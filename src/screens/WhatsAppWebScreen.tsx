import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Trash2 } from "lucide-react";
import { useWaWeb, type WaWebSession } from "@/store/waWeb";
import { confirm } from "@/components/Confirm";
import { Button } from "@/components/ui";

/**
 * A WhatsApp Web session. The header row lets the user rename/remove it; the rest is a
 * placeholder the native (remote, IPC-less) child webview is positioned over. The webview
 * is hidden again when this unmounts, so its login survives switching away.
 */
export function WhatsAppWebScreen({ session, header }: { session: WaWebSession; header: React.ReactNode }) {
  const rename = useWaWeb((s) => s.rename);
  const remove = useWaWeb((s) => s.remove);
  const [name, setName] = useState(session.name);
  useEffect(() => setName(session.name), [session.name]);

  const ref = useRef<HTMLDivElement>(null);
  const syncRef = useRef<() => void>(() => {});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      invoke("wa_web_set_bounds", {
        id: session.id,
        name: session.name,
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        viewportHeight: window.innerHeight,
      }).catch(console.error);
    };
    syncRef.current = sync;
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      invoke("wa_web_hide", { id: session.id }).catch(console.error);
    };
    // name only matters at creation time (notification suffix); don't re-sync on rename
  }, [session.id]);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-neutral-900">
      <div className="flex items-center gap-2 p-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="w-[300px] shrink-0">{header}</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => rename(session.id, name)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="flex-1 min-w-0 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-wa-dark/20"
          title="Session name (click to rename)"
        />
        <Button
          variant="ghost"
          size="sm"
          title="Remove this WhatsApp Web session (logs out locally)"
          onClick={async () => {
            // The native webview sits above React, so hide it while the dialog is up.
            await invoke("wa_web_hide", { id: session.id }).catch(console.error);
            if (await confirm({ title: `Remove “${session.name}”?`, message: "Its WhatsApp Web login and local data are deleted.", danger: true })) {
              await remove(session.id);
            } else {
              syncRef.current();
            }
          }}
        >
          <Trash2 size={16} />
        </Button>
      </div>
      <div ref={ref} className="flex-1 min-h-0 grid place-items-center text-neutral-500">
        <Loader2 className="animate-spin" />
      </div>
    </div>
  );
}
