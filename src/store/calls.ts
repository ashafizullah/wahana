import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { useSettings } from "@/store/settings";

/** Incoming call events (WhatsApp calls can't be answered from the API — only seen and rejected). */
const STORE_FILE = "calls.json";
const MAX = 200;
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));

export interface CallEvent {
  id: string;
  from: string;
  timestamp: number;
  isVideo?: boolean;
  isGroup?: boolean;
}
export interface CallLog extends CallEvent {
  session: string;
  status: "ringing" | "accepted" | "rejected" | "missed";
  at: number;
}

interface State {
  calls: CallLog[];
  /** Currently ringing call, if any. */
  ringing: CallLog | null;
  hydrate: () => Promise<void>;
  apply: (session: string, event: string, e: CallEvent) => void;
  dismiss: () => void;
}

export const useCalls = create<State>((set, get) => ({
  calls: [],
  ringing: null,
  async hydrate() {
    const s = await store();
    set({ calls: (await s.get<CallLog[]>("calls")) ?? [] });
  },
  apply(session, event, e) {
    const now = Math.floor(Date.now() / 1000);
    set((st) => {
      let calls = [...st.calls];
      const idx = calls.findIndex((c) => c.id === e.id);
      if (event === "call.received") {
        const log: CallLog = { ...e, session, status: "ringing", at: now };
        if (idx === -1) calls.unshift(log);
        if (calls.length > MAX) calls.length = MAX;
        if (useSettings.getState().notifications) sendNotification({ title: `Incoming ${e.isVideo ? "video " : ""}call`, body: `From ${e.from.split("@")[0]} — answer on your phone` });
        void store().then((s) => s.set("calls", calls));
        return { calls, ringing: log };
      }
      const status: CallLog["status"] = event === "call.accepted" ? "accepted" : "rejected";
      if (idx >= 0) calls[idx] = { ...calls[idx]!, status };
      else calls = [{ ...e, session, status, at: now }, ...calls].slice(0, MAX);
      void store().then((s) => s.set("calls", calls));
      return { calls, ringing: st.ringing?.id === e.id ? null : st.ringing };
    });
  },
  dismiss() {
    const r = get().ringing;
    if (!r) return;
    set((st) => ({ ringing: null, calls: st.calls.map((c) => (c.id === r.id && c.status === "ringing" ? { ...c, status: "missed" } : c)) }));
  },
}));
