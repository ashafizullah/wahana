import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

/**
 * WhatsApp Web sessions: plain web.whatsapp.com logins rendered in native child webviews,
 * each with its own storage. They sit next to WAHA sessions in the session picker;
 * `active` non-null means the chat screen shows that WhatsApp Web session instead.
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
  active: string | null;
  hydrate: () => Promise<void>;
  add: (name?: string) => WaWebSession;
  rename: (id: string, name: string) => void;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
}

const persist = (st: Pick<State, "sessions" | "active">) =>
  void store().then((s) => Promise.all([s.set("sessions", st.sessions), s.set("active", st.active)]));

export const useWaWeb = create<State>((set, get) => ({
  sessions: [],
  active: null,
  async hydrate() {
    const s = await store();
    const sessions = (await s.get<WaWebSession[]>("sessions")) ?? [];
    let active = (await s.get<string | null>("active")) ?? null;
    if (active && !sessions.some((x) => x.id === active)) active = null;
    set({ sessions, active });
  },
  add(name) {
    const n = get().sessions.length + 1;
    const session = { id: crypto.randomUUID().replace(/-/g, ""), name: name ?? `WhatsApp Web ${n}` };
    set((st) => {
      const next = { sessions: [...st.sessions, session], active: session.id };
      persist(next);
      return next;
    });
    return session;
  },
  rename(id, name) {
    set((st) => {
      const next = { sessions: st.sessions.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)), active: st.active };
      persist(next);
      return next;
    });
  },
  async remove(id) {
    await invoke("wa_web_remove", { id }).catch(console.error);
    set((st) => {
      const next = { sessions: st.sessions.filter((s) => s.id !== id), active: st.active === id ? null : st.active };
      persist(next);
      return next;
    });
  },
  setActive(id) {
    set((st) => {
      const next = { sessions: st.sessions, active: id };
      persist(next);
      return next;
    });
  },
}));
