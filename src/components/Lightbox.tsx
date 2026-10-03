import { useEffect, useRef, useState } from "react";
import { X, Download, ZoomIn, ZoomOut, Loader2, Check, Maximize, Minimize } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { cn } from "@/lib/utils";

export interface LightboxItem {
  blobUrl: string;
  kind: "image" | "video";
  filename: string;
  caption?: string;
  /** Seconds into a video to start from, e.g. where an inline player was. */
  startAt?: number;
}

/**
 * Window-filling viewer for images/videos with zoom and save-to-disk. "Full screen" also
 * takes the app window full screen (the video element's own button doesn't in the webview),
 * and leaves it again on close unless the window was full screen already.
 */
export function Lightbox({ item, onClose }: { item: LightboxItem; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [full, setFull] = useState(false);
  const entered = useRef(false);

  const setFullscreen = (on: boolean) => {
    const win = getCurrentWindow();
    void win
      .isFullscreen()
      .then((was) => {
        if (was === on) return;
        entered.current = on;
        return win.setFullscreen(on);
      })
      .then(() => setFull(on))
      .catch(() => {});
  };

  // Leave full screen with the viewer, but only if it was the viewer that entered it.
  useEffect(
    () => () => {
      if (entered.current)
        void getCurrentWindow()
          .setFullscreen(false)
          .catch(() => {});
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "f" && !e.metaKey && !e.ctrlKey) setFullscreen(!full);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, full]);

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
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex items-center gap-2 p-3 text-white">
        <span className="text-sm truncate flex-1 opacity-80 selectable">{item.filename}</span>
        {item.kind === "image" && (
          <button className="p-2 rounded hover:bg-white/10" onClick={() => setZoom((z) => !z)} title="Zoom">
            {zoom ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
          </button>
        )}
        <button
          className="p-2 rounded hover:bg-white/10"
          onClick={() => setFullscreen(!full)}
          title={full ? "Exit full screen (F)" : "Full screen (F)"}
        >
          {full ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
        <button className="p-2 rounded hover:bg-white/10" onClick={saveToDisk} title="Save to disk" disabled={saving === "busy"}>
          {saving === "busy" ? (
            <Loader2 size={18} className="animate-spin" />
          ) : saving === "done" ? (
            <Check size={18} />
          ) : (
            <Download size={18} />
          )}
        </button>
        <button className="p-2 rounded hover:bg-white/10" onClick={onClose} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      <div
        className={cn("flex-1 min-h-0 flex items-center justify-center p-4", zoom ? "overflow-auto" : "overflow-hidden")}
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {item.kind === "image" ? (
          <img
            src={item.blobUrl}
            alt=""
            draggable={false}
            onDoubleClick={() => setZoom((z) => !z)}
            title="Double-click to zoom"
            className={cn(
              "select-none",
              zoom ? "max-w-none max-h-none m-auto cursor-zoom-out" : "max-w-full max-h-full object-contain cursor-zoom-in",
            )}
          />
        ) : (
          <video
            src={item.blobUrl}
            controls
            autoPlay
            className="max-w-full max-h-full object-contain"
            onLoadedMetadata={(e) => {
              if (item.startAt) e.currentTarget.currentTime = item.startAt;
            }}
          />
        )}
      </div>
      {item.caption && <div className="p-3 text-center text-sm text-white/80 selectable">{item.caption}</div>}
    </div>
  );
}
