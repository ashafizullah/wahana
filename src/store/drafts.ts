import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

/** Unsent composer text per chat (session:chatId), persisted. */
const STORE_FILE = "drafts.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flush: ReturnType<typeof setTimeout> | undefined;

interface State {
  drafts: Record<string, string>;
  hydrate: () => Promise<void>;
  set: (key: string, text: string) => void;
}

export const useDrafts = create<State>((set, get) => ({
  drafts: {},
  async hydrate() {
    const s = await store();
    set({ drafts: (await s.get<Record<string, string>>("drafts")) ?? {} });
  },
  set(key, text) {
    set((st) => {
      const drafts = { ...st.drafts };
      if (text.trim()) drafts[key] = text;
      else delete drafts[key];
      return { drafts };
    });
    clearTimeout(flush);
    flush = setTimeout(() => void store().then((s) => s.set("drafts", get().drafts)), 500);
  },
}));
