import { create } from "zustand";

/** AI notes about an image message (description / extracted text), shown under the media. In-memory only. */
export type ImageNoteKind = "describe" | "ocr";
interface Entry {
  kind: ImageNoteKind;
  text?: string;
  error?: string;
  loading?: boolean;
}
interface State {
  byMsg: Record<string, Entry>;
  set: (id: string, e: Entry) => void;
  clear: (id: string) => void;
}
export const useImageNotes = create<State>((set) => ({
  byMsg: {},
  set: (id, e) => set((st) => ({ byMsg: { ...st.byMsg, [id]: e } })),
  clear: (id) => set((st) => { const byMsg = { ...st.byMsg }; delete byMsg[id]; return { byMsg }; }),
}));
