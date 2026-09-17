import { Fragment, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Columns2, GripVertical, Loader2, Plus, Rows2, Trash2, X } from "lucide-react";
import { useWaWeb, type WaWebSession } from "@/store/waWeb";
import { confirm } from "@/components/Confirm";
import { Button } from "@/components/ui";
import { ResizeHandle } from "@/components/ResizeHandle";
import { cn } from "@/lib/utils";
import { useLatest } from "@/lib/hooks";

/** Narrowest a pane may get; when a row can't fit every pane this wide, panes wrap onto more rows. */
const MIN_PANE_WIDTH = 400;
const HANDLE_WIDTH = 8;

/**
 * WhatsApp Web mode: every session in `panes` side by side, each a native (remote,
 * IPC-less) child webview positioned over its placeholder. Webviews are hidden — not
 * destroyed — when a pane unmounts, so logins survive switching away.
 *
 * Panes share a row by weight (`sizes`); dragging the handle between two panes moves
 * width from one to the other, and dragging a pane's title bar onto another's reorders
 * them. The user picks how many rows to use (`rows`, 0 = auto); native webviews can't be
 * clipped, so instead of scrolling, extra rows are added as needed to keep every pane at
 * least MIN_PANE_WIDTH wide and fully on screen.
 */
export function WhatsAppWebScreen({ header }: { header: React.ReactNode }) {
  const sessions = useWaWeb((s) => s.sessions);
  const panes = useWaWeb((s) => s.panes);
  const active = useWaWeb((s) => s.active);
  const showPane = useWaWeb((s) => s.showPane);
  const add = useWaWeb((s) => s.add);
  const wantedRows = useWaWeb((s) => s.rows);
  const setRows = useWaWeb((s) => s.setRows);
  const shown = panes.map((id) => sessions.find((s) => s.id === id)).filter((s): s is WaWebSession => !!s);
  const hidden = sessions.filter((s) => !panes.includes(s.id));

  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setGridWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maxCols = Math.floor((gridWidth + HANDLE_WIDTH) / (MIN_PANE_WIDTH + HANDLE_WIDTH));
  const wantedCols = wantedRows > 0 ? Math.ceil(shown.length / wantedRows) : maxCols;
  const cols = Math.max(1, Math.min(shown.length, wantedCols, maxCols));
  const rows: WaWebSession[][] = [];
  for (let i = 0; i < shown.length; i += cols) rows.push(shown.slice(i, i + cols));

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-neutral-900">
      <div className="flex items-center gap-2 p-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="w-[300px] shrink-0">{header}</div>
        <span className="text-xs text-neutral-500 flex items-center gap-1 ml-2">
          <Columns2 size={14} /> {shown.length} side by side
        </span>
        <label
          className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300 ml-2"
          title="Lay the panes out in this many rows"
        >
          <Rows2 size={14} />
          <select
            value={wantedRows}
            onChange={(e) => setRows(Number(e.target.value))}
            className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2 py-1.5 outline-none cursor-pointer"
          >
            <option value={0}>Auto rows</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "row" : "rows"}
              </option>
            ))}
          </select>
        </label>
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
            {hidden.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="new">＋ New WhatsApp Web session</option>
          </select>
        </label>
      </div>
      <div ref={gridRef} className="flex-1 min-h-0 flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        {rows.map((row, r) => (
          <PaneRow key={r} row={row} offset={r * cols} count={shown.length} active={active} />
        ))}
        {shown.length === 0 && (
          <div className="flex-1 grid place-items-center text-sm text-neutral-500">No WhatsApp Web session in view — add one above.</div>
        )}
      </div>
    </div>
  );
}

function PaneRow({ row, offset, count, active }: { row: WaWebSession[]; offset: number; count: number; active: string | null }) {
  const sizes = useWaWeb((s) => s.sizes);
  const resizePanes = useWaWeb((s) => s.resizePanes);
  const resetSizes = useWaWeb((s) => s.resetSizes);
  const rowRef = useRef<HTMLDivElement>(null);
  const totalWeight = row.reduce((sum, s) => sum + (sizes[s.id] ?? 1), 0);
  /** Convert a pixel drag into weight units: the row's pane width (handles excluded) carries `totalWeight`. */
  const onDrag = (a: string, b: string, dx: number) => {
    const el = rowRef.current;
    if (!el) return;
    const paneWidth = el.clientWidth - HANDLE_WIDTH * (row.length - 1);
    if (paneWidth <= 0) return;
    const perPx = totalWeight / paneWidth;
    resizePanes(a, b, dx * perPx, MIN_PANE_WIDTH * perPx);
  };
  return (
    <div ref={rowRef} className="flex-1 min-h-0 flex">
      {row.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && (
            <ResizeHandle
              className="w-2 bg-neutral-100 dark:bg-neutral-800"
              onDrag={(dx) => onDrag(row[i - 1]!.id, s.id, dx)}
              onReset={resetSizes}
            />
          )}
          <WaWebPane session={s} isActive={s.id === active} index={offset + i} count={count} weight={sizes[s.id] ?? 1} />
        </Fragment>
      ))}
    </div>
  );
}

const SYNC_EVENT = "wahana:waweb-sync";
const DRAG_TYPE = "application/x-wahana-waweb-pane";
const hideAllPanes = () => Promise.all(useWaWeb.getState().panes.map((id) => invoke("wa_web_hide", { id }).catch(console.error)));
const syncAllPanes = () => window.dispatchEvent(new Event(SYNC_EVENT));
/** After a removal the store has already dropped the pane, so a plain sync only reaches survivors. */
const syncOtherPanes = () => setTimeout(syncAllPanes, 0);

function WaWebPane({
  session,
  isActive,
  index,
  count,
  weight,
}: {
  session: WaWebSession;
  isActive: boolean;
  index: number;
  count: number;
  weight: number;
}) {
  const rename = useWaWeb((s) => s.rename);
  const remove = useWaWeb((s) => s.remove);
  const hidePane = useWaWeb((s) => s.hidePane);
  const movePane = useWaWeb((s) => s.movePane);
  const movePaneTo = useWaWeb((s) => s.movePaneTo);
  const setActive = useWaWeb((s) => s.setActive);
  const unread = useWaWeb((s) => s.unread[session.id] ?? 0);
  const [name, setName] = useState(session.name);
  const [error, setError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState(false);
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
  }, [session.id, nameRef]);
  // Reordering swaps equal-sized placeholders, which no ResizeObserver notices; a rename
  // re-syncs so the webview learns its new notification suffix.
  useEffect(() => {
    syncRef.current();
  }, [index, count, session.name]);

  return (
    <div
      className="flex flex-col"
      style={{ flex: `${weight} 1 0px`, minWidth: MIN_PANE_WIDTH }}
      onMouseDown={() => !isActive && setActive(session.id)}
    >
      {/* Title bar doubles as the drag handle for reordering; other title bars are the drop targets
          (the native webviews below them never see DOM drag events). */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, session.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget(true);
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropTarget(false);
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (id && id !== session.id) movePaneTo(id, session.id);
        }}
        className={cn(
          "flex items-center gap-1 px-2 py-1 border-b text-xs cursor-grab active:cursor-grabbing",
          dropTarget ? "border-wa-dark bg-wa/20 ring-2 ring-inset ring-wa-dark/60" : "border-neutral-200 dark:border-neutral-800",
          !dropTarget && (isActive ? "bg-wa/10" : "bg-neutral-50 dark:bg-neutral-900"),
        )}
        title="Drag onto another pane's title bar to reorder"
      >
        <GripVertical size={14} className="text-neutral-400 shrink-0" />
        <button disabled={index === 0} title="Move left" onClick={() => movePane(session.id, -1)} className="disabled:opacity-30">
          <ChevronLeft size={14} />
        </button>
        <button disabled={index === count - 1} title="Move right" onClick={() => movePane(session.id, 1)} className="disabled:opacity-30">
          <ChevronRight size={14} />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => rename(session.id, name)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          draggable
          onDragStart={(e) => {
            // Let text selection in the name field work; only the bar itself starts a reorder.
            e.preventDefault();
            e.stopPropagation();
          }}
          className="flex-1 min-w-0 bg-transparent px-1.5 py-0.5 rounded outline-none focus:bg-white dark:focus:bg-neutral-800 font-medium cursor-text"
          title="Session name (click to rename)"
        />
        {unread > 0 && (
          <span
            className="min-w-[18px] h-[18px] px-1 rounded-full bg-wa text-[10px] font-bold text-wa-teal grid place-items-center shrink-0"
            title={`${unread} unread chats`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          title="Remove this WhatsApp Web session (logs out locally)"
          onClick={async () => {
            // Native webviews sit above React: hide every pane while the dialog is up.
            await hideAllPanes();
            if (
              await confirm({
                title: `Remove “${session.name}”?`,
                message: "Its WhatsApp Web login and local data are deleted.",
                danger: true,
                confirmLabel: "Remove",
              })
            ) {
              await remove(session.id); // this pane unmounts; don't re-sync it or the webview comes back
              syncOtherPanes();
            } else {
              syncAllPanes();
            }
          }}
        >
          <Trash2 size={13} />
        </Button>
        <Button variant="ghost" size="sm" title="Hide from view (stays logged in)" onClick={() => hidePane(session.id)}>
          <X size={13} />
        </Button>
      </div>
      <div ref={ref} className="flex-1 min-h-0 grid place-items-center text-neutral-500">
        {error ? (
          <div className="max-w-md p-4 text-center text-sm space-y-2">
            <p className="text-red-600 selectable">Couldn't open WhatsApp Web: {error}</p>
            <p className="text-xs">
              Details are in <span className="selectable">waweb.log</span> in the app's data folder.
            </p>
            <Button size="sm" variant="secondary" onClick={() => syncRef.current()}>
              Retry
            </Button>
          </div>
        ) : (
          <Loader2 className="animate-spin" />
        )}
      </div>
    </div>
  );
}
