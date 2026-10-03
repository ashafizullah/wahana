import { useMemo } from "react";
import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { bareId } from "@/store/reactions";

/**
 * Messages pinned for everyone in native chats. Pins are not part of message history,
 * so remember the ones we make and the ones that arrive from other devices, keyed
 * `session:chatId:bareId` → when the pin lapses (unix ms).
 */
const STORE_FILE = "pins.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flush: ReturnType<typeof setTimeout> | undefined;

/** How long a pin can last, as WhatsApp offers it (matches `PinDuration`). */
export const PIN_DURATIONS: { label: string; secs: number }[] = [
  { label: "24 hours", secs: 86_400 },
  { label: "7 days", secs: 604_800 },
  { label: "30 days", secs: 2_592_000 },
];

export const pinKey = (chat: string, messageId: string) => `${chat}:${bareId(messageId)}`;

interface State {
  items: Record<string, number>;
  hydrate: () => Promise<void>;
  /** Pin until `expires` (unix ms), or unpin when `expires` is 0. */
  set: (chat: string, messageId: string, expires: number) => void;
}

export const usePins = create<State>((set, get) => ({
  items: {},
  async hydrate() {
    const s = await store();
    const now = Date.now();
    const saved = (await s.get<Record<string, number>>("items")) ?? {};
    set({ items: Object.fromEntries(Object.entries(saved).filter(([, exp]) => exp > now)) });
  },
  set(chat, messageId, expires) {
    const key = pinKey(chat, messageId);
    set((st) => {
      const items = { ...st.items };
      if (expires > Date.now()) items[key] = expires;
      else delete items[key];
      return { items };
    });
    clearTimeout(flush);
    flush = setTimeout(() => void store().then((s) => s.set("items", get().items)), 1000);
  },
}));

/** Bare ids of the messages pinned in one chat right now, newest pin first (expiry tracks when it was made). */
export function useChatPins(chat: string) {
  const items = usePins((s) => s.items);
  return useMemo(() => {
    const prefix = `${chat}:`;
    const now = Date.now();
    return Object.entries(items)
      .filter(([k, exp]) => k.startsWith(prefix) && exp > now)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k.slice(prefix.length));
  }, [items, chat]);
}

/** Whether a message is pinned right now. */
export const isPinned = (items: Record<string, number>, chat: string, messageId: string) =>
  (items[pinKey(chat, messageId)] ?? 0) > Date.now();
