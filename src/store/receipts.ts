import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { bareId } from "@/store/reactions";

/**
 * Delivery/read timestamps seen over the WebSocket (`message.ack`,
 * `message.ack.group`). History has no receipt times, so this only knows
 * about acks that arrived while the app was running.
 */
const STORE_FILE = "receipts.json";
const MAX = 5000;
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export interface Receipt {
  /** unix ms per ack level: 1 server, 2 delivered, 3 read, 4 played */
  levels: Partial<Record<1 | 2 | 3 | 4, number>>;
  /** group chats: per participant digits → { ack, at } */
  participants?: Record<string, { ack: number; at: number }>;
}

export interface AckEvent {
  id: string;
  from: string;
  to: string;
  participant?: string | null;
  fromMe: boolean;
  ack: number;
  ackName: string;
}

const digits = (id: string) => id.split("@")[0]!.split(":")[0]!;

interface ReceiptsState {
  byMsg: Record<string, Receipt>;
  hydrate: () => Promise<void>;
  apply: (e: AckEvent, atMs: number, group?: boolean) => void;
}

export const useReceipts = create<ReceiptsState>((set, get) => ({
  byMsg: {},
  async hydrate() {
    const s = await store();
    set({ byMsg: (await s.get<Record<string, Receipt>>("byMsg")) ?? {} });
  },
  apply(e, atMs, group = false) {
    if (!e.fromMe || e.ack < 1) return; // only our own messages get receipts
    const key = bareId(e.id);
    set((st) => {
      const cur: Receipt = { levels: { ...(st.byMsg[key]?.levels ?? {}) }, participants: { ...(st.byMsg[key]?.participants ?? {}) } };
      const lvl = Math.min(4, e.ack) as 1 | 2 | 3 | 4;
      if (group && e.participant) {
        const p = digits(e.participant);
        const prev = cur.participants![p];
        if (!prev || prev.ack < lvl) cur.participants![p] = { ack: lvl, at: atMs };
      }
      if (!cur.levels[lvl]) cur.levels[lvl] = atMs;
      const byMsg = { ...st.byMsg, [key]: cur };
      const keys = Object.keys(byMsg);
      if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete byMsg[k];
      return { byMsg };
    });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void store().then((s) => s.set("byMsg", get().byMsg)), 5000);
  },
}));
