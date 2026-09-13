import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

/** Which status updates we've viewed (message id → viewed-at unix s). Pruned after 24h. */
const STORE_FILE = "status-seen.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flush: ReturnType<typeof setTimeout> | undefined;

interface State {
  seen: Record<string, number>;
  hydrate: () => Promise<void>;
  mark: (id: string) => void;
}

export const useStatusSeen = create<State>((set, get) => ({
  seen: {},
  async hydrate() {
    const s = await store();
    const all = (await s.get<Record<string, number>>("seen")) ?? {};
    const cutoff = Date.now() / 1000 - 86_400 * 2;
    const seen: Record<string, number> = {};
    for (const [k, v] of Object.entries(all)) if (v > cutoff) seen[k] = v;
    set({ seen });
  },
  mark(id) {
    if (get().seen[id]) return;
    set((st) => ({ seen: { ...st.seen, [id]: Math.floor(Date.now() / 1000) } }));
    clearTimeout(flush);
    flush = setTimeout(() => void store().then((s) => s.set("seen", get().seen)), 800);
  },
}));
