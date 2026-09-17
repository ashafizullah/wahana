import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * Reactions are not part of message history (GOWS), they only arrive as
 * `message.reaction` events. Keep what we see (and what we send) locally,
 * keyed by the message's bare WhatsApp id → reactor digits → emoji.
 */
const STORE_FILE = "reactions.json";
const MAX_MESSAGES = 5000;
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export const bareId = (id: string) => (id.includes("_") ? (id.split("_")[2] ?? id) : id);
const digits = (id: string) => id.split("@")[0]!.split(":")[0]!;

export interface ReactionEvent {
  id: string;
  from: string;
  fromMe: boolean;
  participant?: string | null;
  reaction: { text: string; messageId: string };
}

interface ReactionsState {
  byMsg: Record<string, Record<string, string>>;
  hydrate: () => Promise<void>;
  apply: (e: ReactionEvent) => void;
  set: (messageId: string, reactor: string, emoji: string) => void;
}

export const useReactions = create<ReactionsState>((set, get) => ({
  byMsg: {},
  async hydrate() {
    const s = await store();
    set({ byMsg: (await s.get<Record<string, Record<string, string>>>("byMsg")) ?? {} });
  },
  apply(e) {
    get().set(e.reaction.messageId, e.fromMe ? "me" : e.participant || e.from, e.reaction.text);
  },
  set(messageId, reactor, emoji) {
    const key = bareId(messageId);
    const who = reactor === "me" ? "me" : digits(reactor);
    set((st) => {
      const cur = { ...(st.byMsg[key] ?? {}) };
      if (emoji) cur[who] = emoji;
      else delete cur[who];
      const byMsg = { ...st.byMsg };
      if (Object.keys(cur).length) byMsg[key] = cur;
      else delete byMsg[key];
      // Bound the map: drop oldest inserted entries.
      const keys = Object.keys(byMsg);
      if (keys.length > MAX_MESSAGES) for (const k of keys.slice(0, keys.length - MAX_MESSAGES)) delete byMsg[k];
      return { byMsg };
    });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void store().then((s) => s.set("byMsg", get().byMsg)), 1000);
  },
}));

/** Group reactions for a message into [emoji, count, includesMe][] . */
export function summarize(map: Record<string, string> | undefined, myDigits: string[]) {
  if (!map) return [];
  const out = new Map<string, { count: number; me: boolean }>();
  for (const [who, emoji] of Object.entries(map)) {
    const cur = out.get(emoji) ?? { count: 0, me: false };
    cur.count++;
    if (who === "me" || myDigits.includes(who)) cur.me = true;
    out.set(emoji, cur);
  }
  return [...out.entries()].map(([emoji, v]) => ({ emoji, ...v }));
}
