import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { useSettings } from "@/store/settings";

/**
 * Local unread tracking. WAHA (GOWS) does not expose unread counts, so we
 * count incoming messages seen over the WebSocket and remember when each
 * chat was last opened (persisted) to flag newer messages after a restart.
 */
const STORE_FILE = "unread.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));

export const chatKey = (session: string, chatId: string) => `${useSettings.getState().activeProfile}:${session}:${chatId}`;

interface UnreadState {
  counts: Record<string, number>;
  lastSeen: Record<string, number>;
  /** Chat currently open in the UI (session:chatId) — messages there never count. */
  open: string | null;
  hydrate: () => Promise<void>;
  incoming: (session: string, chatId: string) => void;
  markSeen: (session: string, chatId: string) => void;
  setOpen: (key: string | null) => void;
}

export const useUnread = create<UnreadState>((set, get) => ({
  counts: {},
  lastSeen: {},
  open: null,

  async hydrate() {
    const s = await store();
    set({ lastSeen: (await s.get<Record<string, number>>("lastSeen")) ?? {} });
  },

  incoming(session, chatId) {
    const key = chatKey(session, chatId);
    if (get().open === key) {
      get().markSeen(session, chatId);
      return;
    }
    set((st) => ({ counts: { ...st.counts, [key]: (st.counts[key] ?? 0) + 1 } }));
  },

  markSeen(session, chatId) {
    const key = chatKey(session, chatId);
    const now = Math.floor(Date.now() / 1000);
    set((st) => {
      const counts = { ...st.counts };
      delete counts[key];
      const lastSeen = { ...st.lastSeen, [key]: now };
      void store().then((s) => s.set("lastSeen", lastSeen));
      return { counts, lastSeen };
    });
  },

  setOpen(key) {
    set({ open: key });
  },
}));

/** Unread indicator for a chat row: a count from live events, or 1 if the last message is newer than last open. */
export function unreadFor(
  st: Pick<UnreadState, "counts" | "lastSeen">,
  session: string,
  chatId: string,
  lastMessage: { fromMe: boolean; timestamp: number } | null | undefined,
): number {
  const key = chatKey(session, chatId);
  const live = st.counts[key] ?? 0;
  if (live) return live;
  const seen = st.lastSeen[key];
  if (seen !== undefined && lastMessage && !lastMessage.fromMe && lastMessage.timestamp > seen) return 1;
  return 0;
}

export function totalUnread(counts: Record<string, number>) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
