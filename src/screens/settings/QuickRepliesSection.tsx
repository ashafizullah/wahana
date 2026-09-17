import { useState } from "react";
import { confirm } from "@/components/Confirm";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteQuickReply, listQuickReplies, saveQuickReply, type QuickReply } from "@/store/quickReplies";
import { useSettings } from "@/store/settings";
import { SessionSelect } from "@/components/SessionSelect";
import { Button, Input, Label } from "@/components/ui";

export function QuickRepliesSection() {
  const profile = useSettings((s) => s.activeProfile);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["quick-replies", profile], queryFn: () => listQuickReplies(profile), enabled: !!profile });
  const [editing, setEditing] = useState<Partial<QuickReply> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["quick-replies", profile] });

  return (
    <>
      <ul className="space-y-1">
        {q.data?.map((r) => (
          <li key={r.id} className="flex items-start gap-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                /{r.shortcut}{" "}
                {r.session && (
                  <span
                    className="ml-1 text-[10px] rounded-full bg-wa/15 text-wa-dark dark:text-wa px-1.5 py-0.5 font-mono font-normal"
                    title="Only in this session"
                  >
                    {r.session}
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
              <SessionSelect
                value={editing.session ?? ""}
                onChange={(v) => setEditing({ ...editing, session: v || null })}
                allowAll="All sessions"
                className="w-full"
              />
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
                  profile,
                  session: editing.session ?? null,
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
