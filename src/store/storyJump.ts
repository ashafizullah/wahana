import { create } from "zustand";

/** A story to open in the status viewer, set from a chat's story reply and taken by the status screen. */
interface State {
  id: string | null;
  open: (id: string) => void;
  take: () => string | null;
}

export const useStoryJump = create<State>((set, get) => ({
  id: null,
  open(id) {
    set({ id });
    window.dispatchEvent(new CustomEvent("wahana:open-status"));
  },
  take() {
    const id = get().id;
    if (id) set({ id: null });
    return id;
  },
}));
