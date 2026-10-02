import { useContext, useState } from "react";
import { confirm } from "@/components/Confirm";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteQuickReply, listQuickReplies, saveQuickReply, type QuickReply } from "@/store/quickReplies";
import { useAccounts } from "@/lib/account";
import { ScopeCtx } from "./shared";
import { Button, Input, Label } from "@/components/ui";

export function QuickRepliesSection() {
  const { scope } = useContext(ScopeCtx);
  const accounts = useAccounts();
  const label = (key: string | null) => {
    if (!key) return null;
    if (key.endsWith(":*")) return `${key.slice(5, -2)} · all sessions`;
    return accounts.find((a) => a.key === key)?.label ?? key;
  };
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["quick-replies", scope],
    queryFn: () => listQuickReplies(scope === "" ? undefined : scope),
  });
  const [editing, setEditing] = useState<Partial<QuickReply> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["quick-replies"] });

  return (
    <>
      <ul className="space-y-1">
        {q.data?.map((r) => (
          <li key={r.id} className="flex items-start gap-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                /{r.shortcut}{" "}
                {label(r.account) && (
                  <span
                    className="ml-1 text-[10px] rounded-full bg-wa/15 text-wa-dark dark:text-wa px-1.5 py-0.5 font-mono font-normal"
                    title="Limited to this account"
                  >
                    {label(r.account)}
                  </span>
                )}
              </span>
              <span className="block text-xs text-neutral-500 whitespace-pre-wrap selectable">{r.text}</span>
            </span>
            <button className="text-neutral-400 hover:text-neutral-700" onClick={() => setEditing(r)} title="Edit">
              <Pencil size={14} />
            </button>
            <button
              className="text-neutral-400 hover:text-red-600"
              title="Delete"
              onClick={async () => {
                if (await confirm({ title: `Delete /${r.shortcut}?`, danger: true, confirmLabel: "Delete" })) {
                  await deleteQuickReply(r.id);
                  refresh();
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {q.data?.length === 0 && !editing && <li className="text-sm text-neutral-500">No quick replies yet.</li>}
      </ul>
      {editing ? (
        <div className="space-y-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Shortcut</Label>
              <Input
                value={editing.shortcut ?? ""}
                onChange={(e) => setEditing({ ...editing, shortcut: e.target.value })}
                placeholder="thanks"
                autoFocus
              />
            </div>
            <div>
              <Label>Available in</Label>
              <div className="px-2 py-2 text-sm text-neutral-500">
                {label(scope === "" ? null : scope) ?? "All accounts"}
                <span className="block text-[11px]">Change it with the "Apply to" selector at the top.</span>
              </div>
            </div>
          </div>
          <div>
            <Label>Text</Label>
            <textarea
              value={editing.text ?? ""}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              rows={3}
              placeholder="Terima kasih {name}, pesanan kamu sedang diproses."
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none"
            />
          </div>
          {err && <div className="text-xs text-red-600">{err}</div>}
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                const shortcut = (editing.shortcut ?? "").replace(/^\//, "").trim();
                if (!shortcut || /\s/.test(shortcut)) return setErr("Shortcut must be one word.");
                if (!(editing.text ?? "").trim()) return setErr("Text is required.");
                await saveQuickReply({
                  id: editing.id ?? Math.random().toString(36).slice(2, 10),
                  account: scope || null,
                  shortcut,
                  text: editing.text!.trim(),
                });
                setEditing(null);
                setErr(null);
                refresh();
              }}
            >
              Save
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setErr(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setEditing({})}>
          <Plus size={14} /> Add quick reply
        </Button>
      )}
    </>
  );
}
