import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag, X, Plus, Trash2, Loader2, Check, Sparkles } from "lucide-react";
import { requireClient, useSettings } from "@/store/settings";
import { aiConfigured, suggestLabels, type LabelSuggestion } from "@/lib/ai";
import { transcript } from "@/lib/exportChat";
import { useNameResolver } from "@/realtime/useNames";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { confirm } from "@/components/Confirm";

export const LABEL_COLORS = ["#ff9485", "#64c4ff", "#ffd429", "#dfaef0", "#99b6c1", "#55ccb3", "#ff9dff", "#d3a91b", "#ffc5c7", "#a9c4a0"];

export function useLabels(session: string) {
  return useQuery({ queryKey: ["labels", session], queryFn: () => requireClient().labels(session), enabled: !!session, staleTime: 60_000 });
}

/** Chat id → label ids, built from each label's chat list (few labels, cheap). */
export function useLabelMap(session: string) {
  const { data: labels } = useLabels(session);
  return useQuery({
    queryKey: ["label-map", session, (labels ?? []).map((l) => l.id).join(",")],
    queryFn: async () => {
      const c = requireClient();
      const map: Record<string, string[]> = {};
      await Promise.all(
        (labels ?? []).map(async (l) => {
          try {
            for (const ch of await c.labelChats(session, l.id)) (map[ch.id] ??= []).push(l.id);
          } catch {
            /* label without chats or unsupported */
          }
        }),
      );
      return map;
    },
    enabled: !!labels,
    staleTime: 60_000,
  });
}

/** Assign labels to a chat; create/delete labels inline. */
export function LabelsDialog({ session, chatId, chatName, onClose }: { session: string; chatId: string; chatName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: labels } = useLabels(session);
  const current = useQuery({ queryKey: ["chat-labels", session, chatId], queryFn: () => requireClient().chatLabels(session, chatId) });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(LABEL_COLORS[0]!);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sel = selected ?? new Set((current.data ?? []).map((l) => l.id));
  const resolveName = useNameResolver(session, chatId);
  const [ai, setAi] = useState<LabelSuggestion | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const suggest = async () => {
    setAiBusy(true);
    setErr(null);
    setAi(null);
    try {
      const msgs = await requireClient().messages(session, chatId, { limit: 30, downloadMedia: false });
      const usable = msgs.filter((m) => m.body || m.hasMedia);
      if (!usable.length) throw new Error("No recent messages to classify.");
      setAi(await suggestLabels(transcript(usable, resolveName), { chatName, existing: (labels ?? []).map((l) => l.name), language: useSettings.getState().aiTranslateTo }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };
  const applySuggested = (names: string[]) => {
    const n = new Set(sel);
    for (const l of labels ?? []) if (names.includes(l.name)) n.add(l.id);
    setSelected(n);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["labels", session] });
    qc.invalidateQueries({ queryKey: ["label-map", session] });
    qc.invalidateQueries({ queryKey: ["chat-labels", session, chatId] });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[400px] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Tag size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1 truncate">Labels · {chatName}</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {(labels ?? []).map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <label className="flex-1 flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                  <input type="checkbox" checked={sel.has(l.id)} onChange={() => { const n = new Set(sel); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); setSelected(n); }} />
                  <span className="w-3 h-3 rounded-full" style={{ background: l.colorHex || "#999" }} />
                  <span className="text-sm">{l.name}</span>
                </label>
                <button className="text-neutral-400 hover:text-red-600" title="Delete label" onClick={async () => { if (await confirm({ title: `Delete label "${l.name}"?`, danger: true, confirmLabel: "Delete" })) { await requireClient().deleteLabel(session, l.id).catch((e) => setErr(String(e))); invalidate(); } }}><Trash2 size={13} /></button>
              </li>
            ))}
            {labels?.length === 0 && <li className="text-sm text-neutral-500">No labels yet.</li>}
          </ul>
          <div className="flex items-center gap-2">
            <Input placeholder="New label" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <div className="flex gap-1">
              {LABEL_COLORS.slice(0, 5).map((c) => (
                <button key={c} onClick={() => setNewColor(c)} className={cn("w-5 h-5 rounded-full border-2", newColor === c ? "border-neutral-800 dark:border-white" : "border-transparent")} style={{ background: c }} />
              ))}
            </div>
            <Button size="sm" variant="secondary" disabled={!newName.trim()} onClick={async () => { try { await requireClient().createLabel(session, newName.trim(), newColor); setNewName(""); invalidate(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }}><Plus size={12} /></Button>
          </div>
          {aiConfigured() && (
            <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2 text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <Sparkles size={12} className="text-wa-dark" />
                <span className="flex-1 text-neutral-600 dark:text-neutral-300">Let AI read the last 30 messages and pick labels.</span>
                <Button size="sm" variant="secondary" disabled={aiBusy} onClick={() => void suggest()}>
                  {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {ai ? "Again" : "Suggest"}
                </Button>
              </div>
              {ai && (
                <div className="space-y-1">
                  {ai.labels.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-neutral-500">Fits:</span>
                      {ai.labels.map((name) => {
                        const l = labels?.find((x) => x.name === name);
                        const on = !!l && sel.has(l.id);
                        return (
                          <button key={name} onClick={() => applySuggested([name])} disabled={on} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5", on ? "border-wa-dark text-wa-dark" : "border-neutral-300 dark:border-neutral-600 hover:bg-white dark:hover:bg-neutral-700")}>
                            <span className="w-2 h-2 rounded-full" style={{ background: l?.colorHex || "#999" }} />{name}{on && <Check size={10} />}
                          </button>
                        );
                      })}
                      {ai.labels.some((name) => { const l = labels?.find((x) => x.name === name); return l && !sel.has(l.id); }) && (
                        <button className="underline text-wa-dark" onClick={() => applySuggested(ai.labels)}>apply all</button>
                      )}
                    </div>
                  ) : (
                    <div className="text-neutral-500">None of the existing labels fit.</div>
                  )}
                  {ai.suggestNew && (
                    <div className="flex items-center gap-1">
                      <span className="text-neutral-500">New label idea:</span>
                      <button className="rounded-full border border-dashed border-neutral-400 px-2 py-0.5 hover:bg-white dark:hover:bg-neutral-700" onClick={() => { setNewName(ai.suggestNew!); }}>+ {ai.suggestNew}</button>
                    </div>
                  )}
                  {ai.reason && <div className="text-neutral-500 italic">{ai.reason}</div>}
                </div>
              )}
            </div>
          )}
          {err && <div className="text-xs text-red-600 selectable">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || selected === null} onClick={async () => { setBusy(true); try { await requireClient().setChatLabels(session, chatId, [...sel]); invalidate(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
