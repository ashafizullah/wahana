import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * WhatsApp Web sessions: plain web.whatsapp.com logins rendered in native child webviews,
 * each with its own storage. They sit next to WAHA sessions in the session picker;
 * `active` non-null means the chat screen shows WhatsApp Web instead, with every session in
 * `panes` side by side (the active one is the one chosen in the picker).
 */
export interface WaWebSession {
  id: string; // 32 hex chars, also names the webview/data store
  name: string;
}

const STORE_FILE = "wa-web.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));

interface State {
  sessions: WaWebSession[];
  /** False on macOS < 14: every WhatsApp Web webview shares one login, so only one session is usable. */
  isolated: boolean;
  active: string | null;
  /** Sessions shown side by side while in WhatsApp Web mode (ordered, left → right). */
  panes: string[];
  /** Relative width of each pane (flex-grow weight); a missing entry means 1. */
  sizes: Record<string, number>;
  /** Rows the split view is laid out in; 0 = as few as fit. More rows are added when panes would get too narrow. */
  rows: number;
  /** Unread chats per session, as reported by each webview from its "(N) WhatsApp" tab title. Not persisted. */
  unread: Record<string, number>;
  hydrate: () => Promise<void>;
  add: (name?: string) => WaWebSession;
  rename: (id: string, name: string) => void;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  /** Add a session to the split view (no-op if already shown). */
  showPane: (id: string) => void;
  /** Take a session out of the split view; leaving WhatsApp Web mode when none is left. */
  hidePane: (id: string) => void;
  movePane: (id: string, dir: -1 | 1) => void;
  /** Drop `id` at `target`'s position (drag-and-drop reorder). */
  movePaneTo: (id: string, target: string) => void;
  setRows: (rows: number) => void;
  /** Move `delta` weight from pane `b` to pane `a` (negative: the other way), keeping both ≥ minWeight. */
  resizePanes: (a: string, b: string, delta: number, minWeight: number) => void;
  /** Back to equal widths. */
  resetSizes: () => void;
}

type Persisted = Pick<State, "sessions" | "active" | "panes" | "sizes" | "rows">;
const KEYS = ["sessions", "active", "panes", "sizes", "rows"] as const satisfies readonly (keyof Persisted)[];
const persist = (st: Persisted) => void store().then((s) => Promise.all(KEYS.map((k) => s.set(k, st[k]))));
const pick = (st: State): Persisted => ({ sessions: st.sessions, active: st.active, panes: st.panes, sizes: st.sizes, rows: st.rows });

export const useWaWeb = create<State>((set, get) => ({
  sessions: [],
  isolated: true,
  active: null,
  panes: [],
  sizes: {},
  rows: 0,
  unread: {},
  async hydrate() {
    invoke<boolean>("wa_web_isolation_supported")
      .then((isolated) => set({ isolated }))
      .catch(console.error);
    listen<{ id: string; count: number }>("waweb-unread", ({ payload }) =>
      set((st) => (st.unread[payload.id] === payload.count ? st : { unread: { ...st.unread, [payload.id]: payload.count } })),
    ).catch(console.error);
    const s = await store();
    const sessions = (await s.get<WaWebSession[]>("sessions")) ?? [];
    const has = (id: string) => sessions.some((x) => x.id === id);
    let active = (await s.get<string | null>("active")) ?? null;
    if (active && !has(active)) active = null;
    let panes = ((await s.get<string[]>("panes")) ?? []).filter(has);
    if (active && !panes.includes(active)) panes = [...panes, active];
    const sizes = Object.fromEntries(
      Object.entries((await s.get<Record<string, number>>("sizes")) ?? {}).filter(([id, w]) => has(id) && Number.isFinite(w) && w > 0),
    );
    const rows = (await s.get<number>("rows")) ?? 0;
    set({ sessions, active, panes, sizes, rows: Number.isInteger(rows) && rows >= 0 ? rows : 0 });
  },
  add(name) {
    const n = get().sessions.length + 1;
    const session = { id: crypto.randomUUID().replace(/-/g, ""), name: name ?? `WhatsApp Web ${n}` };
    set((st) => {
      const next = pick({ ...st, sessions: [...st.sessions, session], active: session.id, panes: [...st.panes, session.id] });
      persist(next);
      return next;
    });
    return session;
  },
  rename(id, name) {
    set((st) => {
      const next = pick({ ...st, sessions: st.sessions.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)) });
      persist(next);
      return next;
    });
  },
  async remove(id) {
    await invoke("wa_web_remove", { id }).catch(console.error);
    set((st) => {
      const panes = st.panes.filter((p) => p !== id);
      const active = st.active === id ? (panes[0] ?? null) : st.active;
      const { [id]: _, ...sizes } = st.sizes;
      const { [id]: _u, ...unread } = st.unread;
      const next = pick({ ...st, sessions: st.sessions.filter((s) => s.id !== id), active, panes, sizes });
      persist(next);
      return { ...next, unread };
    });
  },
  setActive(id) {
    set((st) => {
      const panes = id && !st.panes.includes(id) ? [...st.panes, id] : st.panes;
      const next = pick({ ...st, active: id, panes });
      persist(next);
      return next;
    });
  },
  showPane(id) {
    set((st) => {
      if (st.panes.includes(id)) return st;
      const next = pick({ ...st, panes: [...st.panes, id], active: st.active ?? id });
      persist(next);
      return next;
    });
  },
  hidePane(id) {
    set((st) => {
      const panes = st.panes.filter((p) => p !== id);
      const active = st.active === id ? (panes[0] ?? null) : st.active;
      const next = pick({ ...st, panes, active });
      persist(next);
      return next;
    });
  },
  movePane(id, dir) {
    set((st) => {
      const i = st.panes.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= st.panes.length) return st;
      const panes = [...st.panes];
      [panes[i], panes[j]] = [panes[j]!, panes[i]!];
      const next = pick({ ...st, panes });
      persist(next);
      return next;
    });
  },
  movePaneTo(id, target) {
    set((st) => {
      const from = st.panes.indexOf(id);
      const to = st.panes.indexOf(target);
      if (from < 0 || to < 0 || from === to) return st;
      const panes = st.panes.filter((p) => p !== id);
      panes.splice(to, 0, id);
      const next = pick({ ...st, panes });
      persist(next);
      return next;
    });
  },
  setRows(rows) {
    set((st) => {
      const next = pick({ ...st, rows: Math.max(0, Math.floor(rows)) });
      persist(next);
      return next;
    });
  },
  resizePanes(a, b, delta, minWeight) {
    set((st) => {
      const wa = st.sizes[a] ?? 1;
      const wb = st.sizes[b] ?? 1;
      // Neither pane may shrink below minWeight; clamp the transfer accordingly.
      const d = Math.max(minWeight - wa, Math.min(wb - minWeight, delta));
      if (d === 0) return st;
      const next = pick({ ...st, sizes: { ...st.sizes, [a]: wa + d, [b]: wb - d } });
      persist(next);
      return next;
    });
  },
  resetSizes() {
    set((st) => {
      const next = pick({ ...st, sizes: {} });
      persist(next);
      return next;
    });
  },
}));

/** Unread chats across every WhatsApp Web session. */
export const totalWaWebUnread = (unread: Record<string, number>) => Object.values(unread).reduce((a, b) => a + b, 0);
