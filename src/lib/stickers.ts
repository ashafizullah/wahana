import { invoke } from "@tauri-apps/api/core";

export interface StoredSticker {
  id: string;
  blob: Blob;
  /** "saved" stickers were added by hand; "recent" ones were collected from chats. */
  kind: "saved" | "recent";
  ts: number;
}

const DB = "stickers";
const STORE = "items";
const RECENT_LIMIT = 60;

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};

async function hashId(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert any image to the 512×512 WebP WhatsApp wants for stickers. */
export async function toStickerWebp(file: Blob): Promise<Blob> {
  const out = await invoke<ArrayBuffer>("sticker_from_image", new Uint8Array(await file.arrayBuffer()));
  return new Blob([out], { type: "image/webp" });
}

export const listStickers = async (kind: StoredSticker["kind"]): Promise<StoredSticker[]> => {
  const all = await run<StoredSticker[]>("readonly", (s) => s.getAll());
  return all.filter((x) => x.kind === kind).sort((a, b) => b.ts - a.ts);
};

/** Save a sticker to the tray. A saved sticker is never downgraded to "recent". */
export async function addSticker(blob: Blob, kind: StoredSticker["kind"]): Promise<void> {
  const id = await hashId(blob);
  const existing = await run<StoredSticker | undefined>("readonly", (s) => s.get(id));
  const keepKind = existing?.kind === "saved" ? "saved" : kind;
  await run("readwrite", (s) => s.put({ id, blob, kind: keepKind, ts: Date.now() } satisfies StoredSticker));
  if (keepKind === "recent") {
    const recent = await listStickers("recent");
    await Promise.all(recent.slice(RECENT_LIMIT).map((x) => removeSticker(x.id)));
  }
}

export const removeSticker = (id: string) => run("readwrite", (s) => s.delete(id));

/** Remember a sticker that went through a chat. Never throws: the tray is a convenience. */
export function noteSticker(blob: Blob) {
  if (blob.type && blob.type !== "image/webp") return;
  void addSticker(blob, "recent").catch(() => {});
}

/** The first image on the clipboard (a screenshot, a copied picture), if any. */
export function clipboardImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  const file = [...data.files].find((f) => f.type.startsWith("image/"));
  if (file) return file;
  for (const item of data.items ?? []) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** Screenshots arrive as a generic "image.png"; give them a name that says what they are. */
export function nameClipboardFile(f: File): File {
  if (f.name && f.name !== "image.png" && f.name !== "image") return f;
  const ext = (f.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new File([f], `Screenshot ${stamp}.${ext}`, { type: f.type });
}
