import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * Per-chat local preferences: pinned, muted (no notifications), archived (mirrors the server)
 * AI auto-translate targets and auto-reply takeovers. Keys are session:chatId.
 */
const STORE_FILE = "chat-prefs.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));
let flush: ReturnType<typeof setTimeout> | undefined;

type Flag = "pinned" | "archived";
/** `muted` value: -1 = until I unmute, otherwise the epoch ms the mute ends. */
export const MUTE_FOREVER = -1;
/** True while a stored mute value is in effect (values from older versions, `1`, mean forever). */
export const isMutedUntil = (until: number | undefined, now = Date.now()) => until !== undefined && (until <= 1 || until > now);
/** Auto-translate: `in` = language incoming messages are shown in, `out` = language my drafts are sent in. Either may be unset. */
export interface AutoTranslate {
  in?: string;
  out?: string;
}
/** A chat the user took over from auto-reply: no automatic answers there until released. */
export interface Takeover {
  account: string;
  chatId: string;
  name: string;
  at: number;
}
/** Takeovers are keyed by account key (`native:<id>` / `waha:<profile>:<session>`) + chat. */
export const takeoverKey = (account: string, chatId: string) => `${account}|${chatId}`;
interface State {
  pinned: Record<string, number>; // value = order (timestamp of pinning)
  muted: Record<string, number>;
  archived: Record<string, 1>;
  autoTranslate: Record<string, AutoTranslate>;
  takeover: Record<string, Takeover>;
  hydrate: () => Promise<void>;
  toggle: (flag: Flag, key: string, value?: boolean) => void;
  /** `until`: epoch ms, MUTE_FOREVER, or null to unmute. */
  setMuted: (key: string, until: number | null) => void;
  setAutoTranslate: (key: string, patch: AutoTranslate) => void;
  /** `name` takes the chat over; null releases it back to auto-reply. */
  setTakeover: (account: string, chatId: string, name: string | null) => void;
}

export const useChatPrefs = create<State>((set) => ({
  pinned: {},
  muted: {},
  archived: {},
  autoTranslate: {},
  takeover: {},
  async hydrate() {
    const s = await store();
    set({
      pinned: (await s.get<Record<string, number>>("pinned")) ?? {},
      muted: (await s.get<Record<string, number>>("muted")) ?? {},
      archived: (await s.get<Record<string, 1>>("archived")) ?? {},
      autoTranslate: (await s.get<Record<string, AutoTranslate>>("autoTranslate")) ?? {},
      takeover: (await s.get<Record<string, Takeover>>("takeover")) ?? {},
    });
  },
  toggle(flag, key, value) {
    set((st) => {
      const next = { ...st[flag] } as Record<string, number | 1>;
      const on = value ?? !next[key];
      if (on) next[key] = flag === "pinned" ? Date.now() : 1;
      else delete next[key];
      return { [flag]: next } as Partial<State>;
    });
    schedule();
  },
  setMuted(key, until) {
    set((st) => {
      const next = { ...st.muted };
      if (until === null) delete next[key];
      else next[key] = until === 1 ? MUTE_FOREVER : until;
      return { muted: next };
    });
    schedule();
  },
  setAutoTranslate(key, patch) {
    set((st) => {
      const next = { ...st.autoTranslate };
      const v = { ...(next[key] ?? {}), ...patch };
      if (!v.in) delete v.in;
      if (!v.out) delete v.out;
      if (v.in || v.out) next[key] = v;
      else delete next[key];
      return { autoTranslate: next };
    });
    schedule();
  },
  setTakeover(account, chatId, name) {
    set((st) => {
      const next = { ...st.takeover };
      const key = takeoverKey(account, chatId);
      if (name === null) delete next[key];
      else next[key] = { account, chatId, name, at: Date.now() };
      return { takeover: next };
    });
    schedule();
  },
}));

function schedule() {
  clearTimeout(flush);
  flush = setTimeout(
    () =>
      void store().then(async (s) => {
        const st = useChatPrefs.getState();
        await s.set("pinned", st.pinned);
        await s.set("muted", st.muted);
        await s.set("archived", st.archived);
        await s.set("autoTranslate", st.autoTranslate);
        await s.set("takeover", st.takeover);
      }),
    500,
  );
}
