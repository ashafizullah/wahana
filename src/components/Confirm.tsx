import { useEffect } from "react";
import { create } from "zustand";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface ConfirmChoice {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Single confirm button label (ignored when `choices` is given). */
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Multiple actions (e.g. "Delete for everyone" / "Delete for me"); resolves with the chosen id. */
  choices?: ConfirmChoice[];
}

interface Pending extends ConfirmOptions {
  resolve: (v: string | false) => void;
}

const useConfirmStore = create<{ pending: Pending | null; open: (o: ConfirmOptions) => Promise<string | false>; close: (v: string | false) => void }>((set, get) => ({
  pending: null,
  open: (o) =>
    new Promise((resolve) => {
      get().pending?.resolve(false);
      set({ pending: { ...o, resolve } });
    }),
  close: (v) => {
    get().pending?.resolve(v);
    set({ pending: null });
  },
}));

/** Promise-based confirm: `if (await confirm({ title: "Delete?", danger: true })) …` — resolves "ok", a choice id, or false. */
export const confirm = (o: ConfirmOptions) => useConfirmStore.getState().open(o);

/** Mount once near the root. */
export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const close = useConfirmStore((s) => s.close);
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter" && !pending.choices) close("ok");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, close]);
  if (!pending) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="w-[380px] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-start gap-3 p-4">
          {pending.danger && <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />}
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{pending.title}</div>
            {pending.message && <div className="text-sm text-neutral-600 dark:text-neutral-300 mt-1 selectable">{pending.message}</div>}
          </div>
          <button onClick={() => close(false)} className="text-neutral-400 hover:text-neutral-700"><X size={16} /></button>
        </div>
        <div className={cn("p-3 border-t border-neutral-100 dark:border-neutral-800 flex gap-2", pending.choices ? "flex-col" : "justify-end")}>
          {pending.choices ? (
            <>
              {pending.choices.map((c) => (
                <Button key={c.id} variant={c.danger ? "danger" : "secondary"} className="w-full justify-start" onClick={() => close(c.id)}>
                  <span className="text-left">
                    <span className="block">{c.label}</span>
                    {c.hint && <span className="block text-[11px] font-normal opacity-80">{c.hint}</span>}
                  </span>
                </Button>
              ))}
              <Button variant="ghost" className="w-full" onClick={() => close(false)}>{pending.cancelLabel ?? "Cancel"}</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => close(false)}>{pending.cancelLabel ?? "Cancel"}</Button>
              <Button variant={pending.danger ? "danger" : "primary"} onClick={() => close("ok")} autoFocus>{pending.confirmLabel ?? "OK"}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
