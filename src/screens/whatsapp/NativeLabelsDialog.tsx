import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Tag, Trash2, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { confirm } from "@/components/Confirm";
import { cn, errMsg } from "@/lib/utils";
import { nativeWa, type NativeLabel } from "@/lib/nativeWa";

/** WhatsApp's label palette (label color index → hex). */
const LABEL_COLORS = ["#ff9485", "#64c4ff", "#ffd429", "#dfaef0", "#99b6c1", "#55ccb3", "#ff9dff", "#d3a91b", "#ffc5c7", "#a9c4a0"];

/** WhatsApp label colors are indices; map them onto the shared palette. */
export const labelColorHex = (index: number) => LABEL_COLORS[((index % LABEL_COLORS.length) + LABEL_COLORS.length) % LABEL_COLORS.length]!;

/** Assign labels to a native chat, and create/delete labels inline. */
export function NativeLabelsDialog({
  accountId,
  chatId,
  chatName,
  onChanged,
  onClose,
}: {
  accountId: string;
  chatId: string;
  chatName: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [labels, setLabels] = useState<NativeLabel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [all, mine] = await Promise.all([nativeWa.labels(accountId), nativeWa.chatLabels(accountId, chatId)]);
      setLabels(all);
      setSelected(new Set(mine));
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, chatId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const before = new Set(await nativeWa.chatLabels(accountId, chatId));
      for (const label of labels) {
        const on = selected.has(label.id);
        const was = before.has(label.id);
        if (on && !was) await nativeWa.labelLink(accountId, label.id, chatId, true);
        else if (!on && was) await nativeWa.labelLink(accountId, label.id, chatId, false);
      }
      onChanged();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[400px] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Tag size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1 truncate">Labels · {chatName}</span>
          <button onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {labels.map((label) => (
              <li key={label.id} className="flex items-center gap-2">
                <label className="flex-1 flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                  <input
                    type="checkbox"
                    checked={selected.has(label.id)}
                    onChange={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(label.id)) next.delete(label.id);
                        else next.add(label.id);
                        return next;
                      });
                    }}
                  />
                  <span className="w-3 h-3 rounded-full" style={{ background: labelColorHex(label.color) }} />
                  <span className="text-sm">{label.name}</span>
                </label>
                <button
                  className="text-neutral-400 hover:text-red-600"
                  title="Delete label"
                  onClick={async () => {
                    if (!(await confirm({ title: `Delete label "${label.name}"?`, danger: true, confirmLabel: "Delete" }))) return;
                    try {
                      await nativeWa.labelDelete(accountId, label.id);
                      await reload();
                    } catch (e) {
                      setErr(errMsg(e));
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
            {labels.length === 0 && (
              <li className="text-sm text-neutral-500">No labels yet. Create one below — it also appears on your phone.</li>
            )}
          </ul>
          <div className="flex items-center gap-2">
            <Input placeholder="New label" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <div className="flex gap-1">
              {LABEL_COLORS.slice(0, 5).map((c, i) => (
                <button
                  key={c}
                  onClick={() => setNewColor(i)}
                  className={cn(
                    "w-5 h-5 rounded-full border-2",
                    newColor === i ? "border-neutral-800 dark:border-white" : "border-transparent",
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!newName.trim()}
              onClick={async () => {
                try {
                  const id = await nativeWa.labelCreate(accountId, newName.trim(), newColor);
                  setNewName("");
                  setSelected((prev) => new Set(prev).add(id));
                  await reload();
                } catch (e) {
                  setErr(errMsg(e));
                }
              }}
            >
              <Plus size={12} />
            </Button>
          </div>
          {err && <div className="text-xs text-red-600 selectable">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={save}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
