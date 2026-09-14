import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

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
}

type Persisted = Pick<State, "sessions" | "active" | "panes">;
const persist = (st: Persisted) =>
  void store().then((s) => Promise.all([s.set("sessions", st.sessions), s.set("active", st.active), s.set("panes", st.panes)]));
const pick = (st: State): Persisted => ({ sessions: st.sessions, active: st.active, panes: st.panes });

export const useWaWeb = create<State>((set, get) => ({
  sessions: [],
  isolated: true,
  active: null,
  panes: [],
  async hydrate() {
    invoke<boolean>("wa_web_isolation_supported").then((isolated) => set({ isolated })).catch(console.error);
    const s = await store();
    const sessions = (await s.get<WaWebSession[]>("sessions")) ?? [];
    const has = (id: string) => sessions.some((x) => x.id === id);
    let active = (await s.get<string | null>("active")) ?? null;
    if (active && !has(active)) active = null;
    let panes = ((await s.get<string[]>("panes")) ?? []).filter(has);
    if (active && !panes.includes(active)) panes = [...panes, active];
    set({ sessions, active, panes });
  },
  add(name) {
    const n = get().sessions.length + 1;
    const session = { id: crypto.randomUUID().replace(/-/g, ""), name: name ?? `WhatsApp Web ${n}` };
    set((st) => {
      const next = { sessions: [...st.sessions, session], active: session.id, panes: [...st.panes, session.id] };
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
      const active = st.active === id ? panes[0] ?? null : st.active;
      const next = { sessions: st.sessions.filter((s) => s.id !== id), active, panes };
      persist(next);
      return next;
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
      const active = st.active === id ? panes[0] ?? null : st.active;
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
}));
