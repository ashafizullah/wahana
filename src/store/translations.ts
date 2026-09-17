import { create } from "zustand";

/** Translations shown under bubbles: message id → { text | error | loading }. In-memory only. */
interface Entry {
  target: string;
  text?: string;
  error?: string;
  loading?: boolean;
}
interface State {
  byMsg: Record<string, Entry>;
  set: (id: string, e: Entry) => void;
  clear: (id: string) => void;
}
export const useTranslations = create<State>((set) => ({
  byMsg: {},
  set: (id, e) => set((st) => ({ byMsg: { ...st.byMsg, [id]: e } })),
  clear: (id) =>
    set((st) => {
      const byMsg = { ...st.byMsg };
      delete byMsg[id];
      return { byMsg };
    }),
}));
