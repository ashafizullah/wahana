import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

/** Messages deleted "for me" — hidden locally only (WAHA has no delete-for-me API). */
const STORE_FILE = "hidden.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));

interface State {
  ids: Record<string, 1>;
  hydrate: () => Promise<void>;
  hide: (id: string) => void;
}

export const useHidden = create<State>((set, get) => ({
  ids: {},
  async hydrate() {
    const s = await store();
    set({ ids: (await s.get<Record<string, 1>>("ids")) ?? {} });
  },
  hide(id) {
    set((st) => ({ ids: { ...st.ids, [id]: 1 } }));
    void store().then((s) => s.set("ids", get().ids));
  },
}));
