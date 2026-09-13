import { useEffect, useState } from "react";
import { X, Download, ZoomIn, ZoomOut, Loader2, Check } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { cn } from "@/lib/utils";

export interface LightboxItem {
  blobUrl: string;
  kind: "image" | "video";
  filename: string;
  caption?: string;
}

/** Fullscreen viewer for images/videos with zoom and save-to-disk. */
export function Lightbox({ item, onClose }: { item: LightboxItem; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const saveToDisk = async () => {
    setSaving("busy");
    try {
      const path = await save({ defaultPath: item.filename });
      if (!path) return setSaving("idle");
      const bytes = new Uint8Array(await (await fetch(item.blobUrl)).arrayBuffer());
      await writeFile(path, bytes);
      setSaving("done");
      setTimeout(() => setSaving("idle"), 1500);
    } catch (e) {
      console.error(e);
      setSaving("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex items-center gap-2 p-3 text-white">
        <span className="text-sm truncate flex-1 opacity-80 selectable">{item.filename}</span>
        {item.kind === "image" && (
          <button className="p-2 rounded hover:bg-white/10" onClick={() => setZoom((z) => !z)} title="Zoom">
            {zoom ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
          </button>
        )}
        <button className="p-2 rounded hover:bg-white/10" onClick={saveToDisk} title="Save to disk" disabled={saving === "busy"}>
          {saving === "busy" ? <Loader2 size={18} className="animate-spin" /> : saving === "done" ? <Check size={18} /> : <Download size={18} />}
        </button>
        <button className="p-2 rounded hover:bg-white/10" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      <div
        className={cn("flex-1 min-h-0 grid place-items-center overflow-auto p-4", zoom && "cursor-zoom-out")}
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {item.kind === "image" ? (
          <img
            src={item.blobUrl}
            alt=""
            onClick={() => setZoom((z) => !z)}
            className={cn("select-none", zoom ? "max-w-none cursor-zoom-out" : "max-w-full max-h-full object-contain cursor-zoom-in")}
          />
        ) : (
          <video src={item.blobUrl} controls autoPlay className="max-w-full max-h-full" />
        )}
      </div>
      {item.caption && <div className="p-3 text-center text-sm text-white/80 selectable">{item.caption}</div>}
    </div>
  );
}
