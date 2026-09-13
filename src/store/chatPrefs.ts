import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

/** Per-chat local preferences: pinned, muted (no notifications) and archived (mirrors the server). Keys are session:chatId. */
const STORE_FILE = "chat-prefs.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flush: ReturnType<typeof setTimeout> | undefined;

type Flag = "pinned" | "muted" | "archived";
interface State {
  pinned: Record<string, number>; // value = order (timestamp of pinning)
  muted: Record<string, 1>;
  archived: Record<string, 1>;
  hydrate: () => Promise<void>;
  toggle: (flag: Flag, key: string, value?: boolean) => void;
}

export const useChatPrefs = create<State>((set, get) => ({
  pinned: {},
  muted: {},
  archived: {},
  async hydrate() {
    const s = await store();
    set({
      pinned: (await s.get<Record<string, number>>("pinned")) ?? {},
      muted: (await s.get<Record<string, 1>>("muted")) ?? {},
      archived: (await s.get<Record<string, 1>>("archived")) ?? {},
    });
  },
  toggle(flag, key, value) {
    set((st) => {
      const next = { ...st[flag] } as Record<string, number | 1>;
      const on = value ?? !next[key];
      if (on) next[key] = flag === "pinned" ? Date.now() : 1;
      else delete next[key];
      return { [flag]: next } as Partial<State>;
    });
    clearTimeout(flush);
    flush = setTimeout(() => void store().then(async (s) => { const st = get(); await s.set("pinned", st.pinned); await s.set("muted", st.muted); await s.set("archived", st.archived); }), 500);
  },
}));
