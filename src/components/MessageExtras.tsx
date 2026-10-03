import { Check, CheckCheck, Clock, Copy, Languages, Loader2 as Spinner, ScanText, Sparkles, X } from "lucide-react";
import { langName } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { WaMarkdown, mdToWa } from "@/lib/waMarkdown";
import { useImageNotes } from "@/store/imageNotes";
import { useTranslations } from "@/store/translations";

/** AI translation under a message bubble. */
export function TranslationView({ id }: { id: string }) {
  const t = useTranslations((s) => s.byMsg[id]);
  const clear = useTranslations((s) => s.clear);
  if (!t) return null;
  return (
    <div className="mt-1 rounded-md border-l-2 border-sky-400 bg-sky-50/70 dark:bg-sky-900/20 px-2 py-1 text-xs">
      <div className="flex items-center gap-1 text-[10px] text-sky-700 dark:text-sky-300 mb-0.5">
        <Languages size={10} /> {langName(t.target)}
        <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => clear(id)} title="Hide translation">
          <X size={10} />
        </button>
      </div>
      {t.loading && (
        <span className="flex items-center gap-1 opacity-70">
          <Spinner size={10} className="animate-spin" /> translating…
        </span>
      )}
      {t.error && <span className="text-red-600 selectable">{t.error}</span>}
      {t.text && <div className="whitespace-pre-wrap break-words selectable">{t.text}</div>}
    </div>
  );
}

/** AI description / OCR result under an image bubble. */
export function ImageNoteView({ id }: { id: string }) {
  const n = useImageNotes((s) => s.byMsg[id]);
  const clear = useImageNotes((s) => s.clear);
  if (!n) return null;
  // Descriptions come back as Markdown now and then; OCR text is shown exactly as read.
  const text = n.text && n.kind !== "ocr" ? mdToWa(n.text) : n.text;
  return (
    <div className="mt-1 rounded-md border-l-2 border-violet-400 bg-violet-50/70 dark:bg-violet-900/20 px-2 py-1 text-xs">
      <div className="flex items-center gap-1 text-[10px] text-violet-700 dark:text-violet-300 mb-0.5">
        {n.kind === "ocr" ? <ScanText size={10} /> : <Sparkles size={10} />} {n.kind === "ocr" ? "Extracted text" : "Description"}
        {n.text && (
          <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => void navigator.clipboard.writeText(text!)} title="Copy">
            <Copy size={10} />
          </button>
        )}
        <button className={cn("opacity-60 hover:opacity-100", !n.text && "ml-auto")} onClick={() => clear(id)} title="Hide">
          <X size={10} />
        </button>
      </div>
      {n.loading && (
        <span className="flex items-center gap-1 opacity-70">
          <Spinner size={10} className="animate-spin" /> {n.kind === "ocr" ? "reading text…" : "looking at the image…"}
        </span>
      )}
      {n.error && <span className="text-red-600 selectable">{n.error}</span>}
      {text && <div className="whitespace-pre-wrap break-words selectable">{n.kind === "ocr" ? text : <WaMarkdown text={text} />}</div>}
    </div>
  );
}

/** Delivery state of an outgoing message: pending, sent, delivered, read (blue). */
export function AckIcon({ ack, className }: { ack: number; className?: string }) {
  if (ack <= 0) return <Clock size={12} className={className} />;
  if (ack === 1) return <Check size={12} className={className} />;
  if (ack === 2) return <CheckCheck size={12} className={className} />;
  return <CheckCheck size={12} className={cn("text-sky-500", className)} />;
}
