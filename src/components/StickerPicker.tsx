import { useEffect, useRef, useState } from "react";
import { Plus, Sticker as StickerIcon, Star, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useDismiss } from "@/lib/hooks";
import { addSticker, listStickers, removeSticker, toStickerWebp, type StoredSticker } from "@/lib/stickers";
import { cn, errMsg } from "@/lib/utils";

type Tab = StoredSticker["kind"];

function Thumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img src={url} alt="" className="w-full h-full object-contain" /> : null;
}

/** Sticker button + tray: stickers you saved, and the ones collected from your chats. */
export function StickerButton({ onPick, disabled }: { onPick: (webp: Blob) => void | Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("recent");
  const [items, setItems] = useState<StoredSticker[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const reload = (t: Tab = tab) =>
    listStickers(t)
      .then(setItems)
      .catch(() => setItems([]));
  useEffect(() => {
    if (open) void reload();
  }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (files: FileList | null) => {
    setErr(null);
    try {
      for (const f of [...(files ?? [])]) await addSticker(await toStickerWebp(f), "saved");
      setTab("saved");
      await reload("saved");
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <div ref={ref} className="relative">
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="image/*"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)} disabled={disabled} title="Stickers">
        <StickerIcon size={18} />
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-30 w-72 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-2">
          <div className="flex items-center gap-1 mb-2">
            {(["recent", "saved"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs capitalize",
                  tab === t ? "bg-wa-dark text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                )}
              >
                {t}
              </button>
            ))}
            <button
              onClick={() => fileRef.current?.click()}
              title="Add stickers from image files"
              className="ml-auto p-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Plus size={16} />
            </button>
          </div>
          {err && <div className="text-[11px] text-red-600 mb-1 selectable">{err}</div>}
          {items.length === 0 ? (
            <div className="text-xs text-neutral-500 py-6 text-center px-3">
              {tab === "recent" ? "Stickers you send or receive show up here." : "Press + to add images as stickers."}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto">
              {items.map((s) => (
                <div key={s.id} className="relative group aspect-square">
                  <button
                    onClick={() => {
                      setOpen(false);
                      void onPick(s.blob);
                    }}
                    className="w-full h-full rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Thumb blob={s.blob} />
                  </button>
                  <button
                    onClick={() => void (tab === "recent" ? addSticker(s.blob, "saved") : removeSticker(s.id)).then(() => reload())}
                    title={tab === "recent" ? "Save sticker" : "Remove sticker"}
                    className="absolute top-0 right-0 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100"
                  >
                    {tab === "recent" ? <Star size={11} /> : <X size={11} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
