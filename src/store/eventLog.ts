import { create } from "zustand";
import type { WahaEvent } from "@/api/types";

export interface LogEntry {
  seq: number;
  at: number;
  event: WahaEvent;
}

const MAX = 300;
let seq = 0;

/** Ring buffer of recent WebSocket events for the Events tab. */
export const useEventLog = create<{
  entries: LogEntry[];
  paused: boolean;
  push: (e: WahaEvent) => void;
  clear: () => void;
  setPaused: (p: boolean) => void;
}>((set, get) => ({
  entries: [],
  paused: false,
  push(event) {
    if (get().paused) return;
    set((s) => {
      const next = [{ seq: ++seq, at: Date.now(), event }, ...s.entries];
      if (next.length > MAX) next.length = MAX;
      return { entries: next };
    });
  },
  clear: () => set({ entries: [] }),
  setPaused: (paused) => set({ paused }),
}));
