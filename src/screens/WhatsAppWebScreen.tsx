import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Columns2, Loader2, Plus, Trash2, X } from "lucide-react";
import { useWaWeb, type WaWebSession } from "@/store/waWeb";
import { confirm } from "@/components/Confirm";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useLatest } from "@/lib/hooks";

/**
 * WhatsApp Web mode: every session in `panes` side by side, each a native (remote,
 * IPC-less) child webview positioned over its placeholder. Webviews are hidden — not
 * destroyed — when a pane unmounts, so logins survive switching away.
 */
export function WhatsAppWebScreen({ header }: { header: React.ReactNode }) {
  const sessions = useWaWeb((s) => s.sessions);
  const panes = useWaWeb((s) => s.panes);
  const active = useWaWeb((s) => s.active);
  const showPane = useWaWeb((s) => s.showPane);
  const add = useWaWeb((s) => s.add);
  const shown = panes.map((id) => sessions.find((s) => s.id === id)).filter((s): s is WaWebSession => !!s);
  const hidden = sessions.filter((s) => !panes.includes(s.id));

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-neutral-900">
      <div className="flex items-center gap-2 p-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="w-[300px] shrink-0">{header}</div>
        <span className="text-xs text-neutral-500 flex items-center gap-1 ml-2"><Columns2 size={14} /> {shown.length} side by side</span>
        <label className="ml-auto flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
          <Plus size={14} />
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "new") add();
              else if (v) showPane(v);
            }}
            className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2 py-1.5 outline-none cursor-pointer"
            title="Show another WhatsApp Web session next to these"
          >
            <option value="">Add to view…</option>
            {hidden.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="new">＋ New WhatsApp Web session</option>
          </select>
        </label>
      </div>
      <div className="flex-1 min-h-0 flex divide-x divide-neutral-200 dark:divide-neutral-800">
        {shown.map((s, i) => (
          <WaWebPane key={s.id} session={s} isActive={s.id === active} index={i} count={shown.length} />
        ))}
        {shown.length === 0 && <div className="flex-1 grid place-items-center text-sm text-neutral-500">No WhatsApp Web session in view — add one above.</div>}
      </div>
    </div>
  );
}

const SYNC_EVENT = "wahana:waweb-sync";
const hideAllPanes = () => Promise.all(useWaWeb.getState().panes.map((id) => invoke("wa_web_hide", { id }).catch(console.error)));
const syncAllPanes = () => window.dispatchEvent(new Event(SYNC_EVENT));
/** After a removal the store has already dropped the pane, so a plain sync only reaches survivors. */
const syncOtherPanes = () => setTimeout(syncAllPanes, 0);

function WaWebPane({ session, isActive, index, count }: { session: WaWebSession; isActive: boolean; index: number; count: number }) {
  const rename = useWaWeb((s) => s.rename);
  const remove = useWaWeb((s) => s.remove);
  const hidePane = useWaWeb((s) => s.hidePane);
  const movePane = useWaWeb((s) => s.movePane);
  const setActive = useWaWeb((s) => s.setActive);
  const [name, setName] = useState(session.name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(session.name), [session.name]);

  const ref = useRef<HTMLDivElement>(null);
  const syncRef = useRef<() => void>(() => {});
  const nameRef = useLatest(session.name);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      invoke("wa_web_set_bounds", {
        id: session.id,
        name: nameRef.current,
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        viewportHeight: window.innerHeight,
      })
        .then(() => setError(null))
        .catch((e) => {
          console.error(e);
          setError(String(e));
        });
    };
    syncRef.current = sync;
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    window.addEventListener(SYNC_EVENT, sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener(SYNC_EVENT, sync);
      invoke("wa_web_hide", { id: session.id }).catch(console.error);
    };
  }, [session.id]);
  // Reordering swaps equal-sized placeholders, which no ResizeObserver notices; a rename
  // re-syncs so the webview learns its new notification suffix.
  useEffect(() => { syncRef.current(); }, [index, count, session.name]);

  return (
    <div className="flex-1 min-w-0 flex flex-col" onMouseDown={() => !isActive && setActive(session.id)}>
      <div className={cn("flex items-center gap-1 px-2 py-1 border-b border-neutral-200 dark:border-neutral-800 text-xs", isActive ? "bg-wa/10" : "bg-neutral-50 dark:bg-neutral-900")}>
        <button disabled={index === 0} title="Move left" onClick={() => movePane(session.id, -1)} className="disabled:opacity-30"><ChevronLeft size={14} /></button>
        <button disabled={index === count - 1} title="Move right" onClick={() => movePane(session.id, 1)} className="disabled:opacity-30"><ChevronRight size={14} /></button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => rename(session.id, name)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="flex-1 min-w-0 bg-transparent px-1.5 py-0.5 rounded outline-none focus:bg-white dark:focus:bg-neutral-800 font-medium"
          title="Session name (click to rename)"
        />
        <Button
          variant="ghost"
          size="sm"
          title="Remove this WhatsApp Web session (logs out locally)"
          onClick={async () => {
            // Native webviews sit above React: hide every pane while the dialog is up.
            await hideAllPanes();
            if (await confirm({ title: `Remove “${session.name}”?`, message: "Its WhatsApp Web login and local data are deleted.", danger: true, confirmLabel: "Remove" })) {
              await remove(session.id); // this pane unmounts; don't re-sync it or the webview comes back
              syncOtherPanes();
            } else {
              syncAllPanes();
            }
          }}
        >
          <Trash2 size={13} />
        </Button>
        <Button variant="ghost" size="sm" title="Hide from view (stays logged in)" onClick={() => hidePane(session.id)}><X size={13} /></Button>
      </div>
      <div ref={ref} className="flex-1 min-h-0 grid place-items-center text-neutral-500">
        {error ? (
          <div className="max-w-md p-4 text-center text-sm space-y-2">
            <p className="text-red-600 selectable">Couldn't open WhatsApp Web: {error}</p>
            <p className="text-xs">Details are in <span className="selectable">waweb.log</span> in the app's data folder.</p>
            <Button size="sm" variant="secondary" onClick={() => syncRef.current()}>Retry</Button>
          </div>
        ) : (
          <Loader2 className="animate-spin" />
        )}
      </div>
    </div>
  );
}
