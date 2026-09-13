import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { bareId } from "@/store/reactions";

/** Poll votes seen over `poll.vote` events: poll message id → voter digits → selected options. */
const STORE_FILE = "polls.json";
const MAX = 2000;
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flush: ReturnType<typeof setTimeout> | undefined;

export interface PollVoteEvent {
  vote: { id: string; selectedOptions: string[]; from: string; fromMe: boolean; participant?: string | null; timestamp: number };
  poll: { id: string; to?: string };
}

const digits = (id: string) => id.split("@")[0]!.split(":")[0]!;

interface State {
  byPoll: Record<string, Record<string, string[]>>;
  hydrate: () => Promise<void>;
  apply: (e: PollVoteEvent) => void;
  setOwn: (pollId: string, options: string[], voter?: string) => void;
}

export const usePolls = create<State>((set, get) => ({
  byPoll: {},
  async hydrate() {
    const s = await store();
    set({ byPoll: (await s.get<Record<string, Record<string, string[]>>>("byPoll")) ?? {} });
  },
  apply(e) {
    const voter = e.vote.fromMe ? "me" : digits(e.vote.participant || e.vote.from);
    get().setOwn(e.poll.id, e.vote.selectedOptions, voter);
  },
  setOwn(pollId, options, voter = "me") {
    const key = bareId(pollId);
    set((st) => {
      const cur = { ...(st.byPoll[key] ?? {}) };
      if (options.length) cur[voter] = options;
      else delete cur[voter];
      const byPoll = { ...st.byPoll, [key]: cur };
      const keys = Object.keys(byPoll);
      if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete byPoll[k];
      return { byPoll };
    });
    clearTimeout(flush);
    flush = setTimeout(() => void store().then((s) => s.set("byPoll", get().byPoll)), 1000);
  },
}));
