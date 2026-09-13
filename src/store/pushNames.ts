import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { WAMessage } from "@/api/types";

/**
 * Push names harvested from messages. WhatsApp only sends a participant's
 * profile name attached to their messages, so we remember every one we see
 * (keyed by LID and phone digits) and use it as a fallback for display.
 */
const STORE_FILE = "pushnames.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const digits = (id: string | undefined | null) => id?.split("@")[0]?.split(":")[0] ?? "";

interface PushNamesState {
  names: Record<string, string>;
  hydrate: () => Promise<void>;
  learn: (messages: WAMessage[]) => void;
}

export const usePushNames = create<PushNamesState>((set, get) => ({
  names: {},
  async hydrate() {
    const s = await store();
    set({ names: (await s.get<Record<string, string>>("names")) ?? {} });
  },
  learn(messages) {
    const cur = get().names;
    let next: Record<string, string> | null = null;
    for (const m of messages) {
      if (m.fromMe) continue;
      const info = (m._data as { Info?: { PushName?: string; Sender?: string; SenderAlt?: string } } | undefined)?.Info;
      const name = info?.PushName?.trim();
      if (!name) continue;
      for (const id of [info?.Sender, info?.SenderAlt, m.participant, m.from]) {
        const d = digits(id);
        if (d && !id?.endsWith("@g.us") && cur[d] !== name && (next ?? cur)[d] !== name) {
          next ??= { ...cur };
          next[d] = name;
        }
      }
    }
    if (!next) return;
    set({ names: next });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void store().then((s) => s.set("names", get().names)), 1500);
  },
}));
