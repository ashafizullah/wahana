import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { bareId } from "@/store/reactions";

/**
 * Tombstones for messages deleted for everyone. The server drops revoked
 * messages from history, so we remember enough to draw
 * "This message was deleted" in place.
 */
const STORE_FILE = "revoked.json";
const MAX = 3000;
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flush: ReturnType<typeof setTimeout> | undefined;

export interface Tombstone {
  /** "revoked" = deleted for everyone; "waiting" = could not be decrypted yet (WhatsApp "Waiting for this message"). */
  kind?: "revoked" | "waiting";
  id: string; // bare message id
  chat: string; // session:chatId
  timestamp: number; // original send time (unix s) when known, else revoke time
  fromMe: boolean;
  participant?: string | null;
  from?: string | null;
  at: number; // revoked at (unix s)
}

interface State {
  items: Record<string, Tombstone>; // key: chat + ":" + id
  hydrate: () => Promise<void>;
  add: (t: Omit<Tombstone, "at" | "id"> & { id: string }) => void;
  remove: (chat: string, id: string) => void;
}

export const useRevoked = create<State>((set, get) => ({
  items: {},
  async hydrate() {
    const s = await store();
    set({ items: (await s.get<Record<string, Tombstone>>("items")) ?? {} });
  },
  remove(chat, id) {
    const key = `${chat}:${bareId(id)}`;
    if (!get().items[key]) return;
    set((st) => {
      const items = { ...st.items };
      delete items[key];
      return { items };
    });
    clearTimeout(flush);
    flush = setTimeout(() => void store().then((s) => s.set("items", get().items)), 1000);
  },
  add(t) {
    const id = bareId(t.id);
    const key = `${t.chat}:${id}`;
    const cur = get().items[key];
    if (cur && (cur.kind ?? "revoked") === (t.kind ?? "revoked")) return;
    set((st) => {
      const items = { ...st.items, [key]: { ...t, id, at: Math.floor(Date.now() / 1000) } };
      const keys = Object.keys(items);
      if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete items[k];
      return { items };
    });
    clearTimeout(flush);
    flush = setTimeout(() => void store().then((s) => s.set("items", get().items)), 1000);
  },
}));

/** Tombstones for one chat. */
export function tombstonesFor(items: Record<string, Tombstone>, chat: string) {
  return Object.values(items).filter((t) => t.chat === chat);
}
