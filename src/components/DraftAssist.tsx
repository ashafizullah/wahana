import { useEffect, useState } from "react";
import { Languages, Loader2 as Spinner, Undo2, WandSparkles } from "lucide-react";
import { Button, MenuItem, Popover } from "@/components/ui";
import { aiConfigured, langName, rewriteDraft, translate, REWRITE_MODES, type RewriteMode } from "@/lib/ai";
import { errMsg } from "@/lib/utils";
import { useSettings } from "@/store/settings";

/** 🌐 button in the composer: translate the draft into the compose language. */
export function TranslateDraftButton({ text, onResult }: { text: string; onResult: (t: string) => void }) {
  const target = useSettings((s) => s.aiComposeTo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = aiConfigured();
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        disabled={!text.trim() || busy || !ready}
        title={ready ? `Translate draft to ${langName(target)} (⌘⇧T)` : "Set up AI in Settings to translate"}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            onResult(await translate(text, target));
          } catch (e) {
            setErr(errMsg(e));
            setTimeout(() => setErr(null), 4000);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner size={18} className="animate-spin" /> : <Languages size={18} />}
      </Button>
      {err && (
        <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg bg-red-600 text-white text-xs px-2 py-1 shadow z-30 selectable">
          {err}
        </div>
      )}
    </div>
  );
}

/** ✨ menu in the composer: rewrite the draft (fix / formal / casual / …) with one-step undo. */
export function WriteAssistButton({ text, onResult }: { text: string; onResult: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<RewriteMode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const ready = aiConfigured();
  useEffect(() => {
    if (!text) setUndo(null);
  }, [text]); // draft sent or cleared → nothing to undo
  const run = async (mode: RewriteMode) => {
    setOpen(false);
    setBusy(mode);
    setErr(null);
    try {
      const before = text;
      const out = await rewriteDraft(text, mode);
      if (out) {
        setUndo(before);
        onResult(out);
      }
    } catch (e) {
      setErr(errMsg(e));
      setTimeout(() => setErr(null), 4000);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        side="top"
        className="w-52 py-1"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            disabled={(!text.trim() && !undo) || !!busy || !ready}
            title={ready ? "Writing assistant" : "Set up AI in Settings to use the writing assistant"}
            onClick={() => setOpen((v) => !v)}
          >
            {busy ? <Spinner size={18} className="animate-spin" /> : <WandSparkles size={18} />}
          </Button>
        }
      >
        {undo && (
          <>
            <MenuItem
              onClick={() => {
                onResult(undo);
                setUndo(null);
                setOpen(false);
              }}
            >
              <Undo2 size={14} /> Undo last rewrite
            </MenuItem>
            <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          </>
        )}
        {REWRITE_MODES.map(([id, label]) => (
          <MenuItem key={id} disabled={!text.trim()} onClick={() => void run(id)}>
            {label}
          </MenuItem>
        ))}
      </Popover>
      {err && (
        <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg bg-red-600 text-white text-xs px-2 py-1 shadow z-30 selectable">
          {err}
        </div>
      )}
    </div>
  );
}
