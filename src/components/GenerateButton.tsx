import { useState } from "react";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { Button, Popover } from "@/components/ui";
import { aiConfigured, generateContent, type ContentKind } from "@/lib/ai";
import { useSettings } from "@/store/settings";
import { errMsg } from "@/lib/utils";

/**
 * "Draft with AI": a brief → a ready-to-send WhatsApp message (persona-aware), for the
 * broadcast / status / group composers. One request per click; the previous text can be restored.
 */
export function GenerateButton({ kind, text, onResult, session }: { kind: ContentKind; text: string; onResult: (t: string) => void; session?: string }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const ready = aiConfigured();
  const language = useSettings((s) => s.aiComposeTo);

  const run = async () => {
    if (!brief.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const out = await generateContent(brief, { kind, language, session, current: text });
      if (out) {
        setUndo(text);
        onResult(out);
        setOpen(false);
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-1">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        className="w-80 p-3 space-y-2"
        trigger={
          <Button size="sm" variant="secondary" disabled={!ready || busy} title={ready ? "Write this message from a short brief" : "Set up AI in Settings first"} onClick={() => setOpen((v) => !v)}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Draft with AI
          </Button>
        }
      >
          <div className="text-xs text-neutral-500">What should the message say? Facts only — the AI writes the wording in your persona's voice.</div>
          <textarea
            autoFocus
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run(); if (e.key === "Escape") setOpen(false); }}
            rows={4}
            placeholder={kind === "status" ? "e.g. closed tomorrow for Idul Adha, open again Thursday" : "e.g. 20% off all cables this weekend, pickup only, mention free parking"}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 outline-none focus:border-wa-dark resize-y"
          />
          {err && <div className="text-xs text-red-600 selectable">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!brief.trim() || busy} onClick={() => void run()}>{busy && <Loader2 size={12} className="animate-spin" />} Generate</Button>
          </div>
      </Popover>
      {undo !== null && (
        <Button size="sm" variant="ghost" title="Restore the previous text" onClick={() => { onResult(undo); setUndo(null); }}>
          <Undo2 size={12} />
        </Button>
      )}
    </div>
  );
}
