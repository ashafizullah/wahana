import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { WAMessage } from "@/api/types";

/**
 * Messages received live over the WebSocket, kept locally so they survive a
 * history refetch. Needed because WAHA (GOWS) sometimes does not persist a
 * message it delivered — e.g. one sent by another session on the same server.
 * Bounded per chat and pruned after 7 days.
 */
const STORE_FILE = "live-messages.json";
const PER_CHAT = 150;
const MAX_AGE = 7 * 86_400;
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flush: ReturnType<typeof setTimeout> | undefined;

/** Strip bulky raw data we don't need for rendering to keep the file small. */
function slim(m: WAMessage): WAMessage {
  const data = m._data as { Info?: unknown; Message?: Record<string, unknown> } | undefined;
  const msg = data?.Message ? { ...data.Message } : undefined;
  if (msg) for (const k of Object.keys(msg)) {
    const v = msg[k] as Record<string, unknown> | undefined;
    if (v && typeof v === "object" && "JPEGThumbnail" in v && typeof v.JPEGThumbnail === "string" && (v.JPEGThumbnail as string).length > 12_000) msg[k] = { ...v, JPEGThumbnail: undefined };
  }
  return { ...m, _data: data ? ({ Info: data.Info, Message: msg } as never) : m._data };
}

interface State {
  byChat: Record<string, WAMessage[]>; // session:chatId → newest first
  hydrate: () => Promise<void>;
  add: (session: string, chatId: string, m: WAMessage) => void;
}

export const useLiveMessages = create<State>((set, get) => ({
  byChat: {},
  async hydrate() {
    const s = await store();
    const all = (await s.get<Record<string, WAMessage[]>>("byChat")) ?? {};
    const cutoff = Date.now() / 1000 - MAX_AGE;
    const byChat: Record<string, WAMessage[]> = {};
    for (const [k, list] of Object.entries(all)) {
      const kept = list.filter((m) => m.timestamp > cutoff);
      if (kept.length) byChat[k] = kept;
    }
    set({ byChat });
  },
  add(session, chatId, m) {
    const key = `${session}:${chatId}`;
    set((st) => {
      const cur = st.byChat[key] ?? [];
      const next = [slim(m), ...cur.filter((x) => x.id !== m.id)].slice(0, PER_CHAT);
      return { byChat: { ...st.byChat, [key]: next } };
    });
    clearTimeout(flush);
    flush = setTimeout(() => void store().then((s) => s.set("byChat", get().byChat)), 2000);
  },
}));
