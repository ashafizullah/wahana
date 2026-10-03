import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { deleteSecret, getSecret, setSecret } from "@/lib/secrets";

const STORE_FILE = "settings.json";

let storePromise: Promise<Store> | null = null;
function store() {
  storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} });
  return storePromise;
}

/** When read receipts (blue ticks) are sent. */
export type ReadReceipts = "always" | "on-reply" | "manual" | "never";

/** Global preferences persisted in the plain store file. */
export interface Prefs {
  notifications: boolean;
  /** Auto-download media inline; when false, show a blurred placeholder until clicked. */
  autoLoadImages: boolean;
  autoLoadStickers: boolean;
  autoLoadVideos: boolean;
  autoLoadAudio: boolean;
  /** On-disk media cache cap in MB (0 = unlimited). */
  cacheLimitMb: number;
  /** Fetch Open Graph previews for links whose message has no embedded preview. */
  linkPreviews: boolean;
  /** Send "typing…" presence to the other side while composing. */
  sendTyping: boolean;
  /** When to send read receipts (blue ticks): on opening a chat, only when you reply, or never. */
  readReceipts: ReadReceipts;
  // ── AI ──
  aiProvider: "anthropic" | "openai-compatible";
  aiBaseUrl: string;
  aiModel: string;
  /** Cheaper/faster model for short tasks (translate, rewrite, smart replies); empty = use aiModel. */
  aiFastModel: string;
  /** Language incoming messages are translated into. */
  aiTranslateTo: string;
  /** Language your drafts are translated into with the composer 🌐 button. */
  aiComposeTo: string;
  /** Persona / standing instructions prepended to every AI feature (who you are, your business, tone). */
  aiSystemPrompt: string;
  /** Assign existing labels to new direct chats automatically (one AI call per new chat). */
  aiAutoLabel: boolean;
  /** Kill switch for all auto-reply rules. */
  autoReplyPaused: boolean;
  /** Max auto-replies sent per calendar day per account across its rules (0 = unlimited). Spend guard for AI replies. */
  autoReplyDailyLimit: number;
  /** Minutes auto-reply stays quiet in a chat after the user wrote there themselves (0 = never). */
  autoReplyManualQuietMin: number;
  // ── Per-account overrides ──
  // Keyed by account (`native:<accountId>`); a missing entry
  // falls back to the global value above, so one setting can still cover every number.
  sendTypingByAccount: Record<string, boolean>;
  readReceiptsByAccount: Record<string, ReadReceipts>;
  /** Persona per account; missing or empty = use aiSystemPrompt. */
  aiPersonaByAccount: Record<string, string>;
}

const DEFAULT_PREFS: Prefs = {
  notifications: true,
  autoLoadImages: true,
  autoLoadStickers: true,
  autoLoadVideos: false,
  autoLoadAudio: true,
  cacheLimitMb: 1024,
  linkPreviews: true,
  sendTyping: true,
  readReceipts: "always",
  aiProvider: "openai-compatible",
  aiBaseUrl: "",
  aiModel: "",
  aiFastModel: "",
  aiTranslateTo: "id",
  aiComposeTo: "en",
  aiSystemPrompt: "",
  aiAutoLabel: false,
  autoReplyPaused: false,
  autoReplyDailyLimit: 300,
  autoReplyManualQuietMin: 15,
  sendTypingByAccount: {},
  readReceiptsByAccount: {},
  aiPersonaByAccount: {},
};

interface SettingsState extends Prefs {
  hydrated: boolean;
  /** AI provider key (keychain entry "ai"). */
  aiApiKey: string;

  hydrate: () => Promise<void>;
  save: (patch: Partial<Prefs & { aiApiKey: string }>) => Promise<void>;
  clear: () => Promise<void>;
}

export const useSettings = create<SettingsState>((set) => ({
  ...DEFAULT_PREFS,
  hydrated: false,
  aiApiKey: "",

  async hydrate() {
    const s = await store();
    const prefs = { ...DEFAULT_PREFS };
    for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
      const v = await s.get<Prefs[typeof k]>(k);
      if (v !== undefined && v !== null) (prefs as Record<string, unknown>)[k] = v;
    }
    const legacyReceipts = await s.get<boolean>("sendReadReceipts");
    if (legacyReceipts === false) prefs.readReceipts = "never";
    set({ hydrated: true, ...prefs, aiApiKey: await getSecret("ai") });
  },

  async save(patch) {
    const s = await store();
    const { aiApiKey, ...prefPatch } = patch;
    for (const [k, v] of Object.entries(prefPatch)) await s.set(k, v);
    if (aiApiKey !== undefined) {
      await setSecret("ai", aiApiKey.trim());
      set({ aiApiKey: aiApiKey.trim() });
    }
    set(prefPatch);
  },

  async clear() {
    const s = await store();
    await deleteSecret("ai");
    await s.clear();
    set({ ...DEFAULT_PREFS, aiApiKey: "" });
  },
}));

// ── Per-account resolution (falls back to the global value) ──────────────

/** Read-receipt mode in effect for an account (`null` = the global default). */
export const readReceiptsFor = (account: string | null): ReadReceipts => {
  const s = useSettings.getState();
  return (account ? s.readReceiptsByAccount[account] : undefined) ?? s.readReceipts;
};

/** Whether typing presence is sent for an account (`null` = the global default). */
export const sendTypingFor = (account: string | null): boolean => {
  const s = useSettings.getState();
  return (account ? s.sendTypingByAccount[account] : undefined) ?? s.sendTyping;
};

/** Reactive variants, for components that render based on the effective value. */
export const useReadReceipts = (account: string | null): ReadReceipts =>
  useSettings((s) => (account ? s.readReceiptsByAccount[account] : undefined) ?? s.readReceipts);

export const useSendTyping = (account: string | null): boolean =>
  useSettings((s) => (account ? s.sendTypingByAccount[account] : undefined) ?? s.sendTyping);

export type MediaKind = "image" | "sticker" | "video" | "audio" | "document";
export type MediaPrefs = Pick<Prefs, "autoLoadImages" | "autoLoadStickers" | "autoLoadVideos" | "autoLoadAudio">;

/**
 * Classify message media. Stickers are image/webp on the wire, so they are
 * detected from the raw payload (`Info.MediaType === "sticker"` / `stickerMessage`).
 */
export function mediaKind(m: { media?: { mimetype?: string } | null; _data?: unknown }): MediaKind {
  const raw = m._data as { Info?: { MediaType?: string }; Message?: Record<string, unknown> } | undefined;
  if (raw?.Info?.MediaType === "sticker" || raw?.Message?.stickerMessage) return "sticker";
  const mimetype = m.media?.mimetype;
  if (!mimetype) return "document";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
}

/** Whether media of this kind should download without a click. */
export function shouldAutoLoad(kind: MediaKind, p: MediaPrefs) {
  switch (kind) {
    case "image":
      return p.autoLoadImages;
    case "sticker":
      return p.autoLoadStickers;
    case "video":
      return p.autoLoadVideos;
    case "audio":
      return p.autoLoadAudio;
    default:
      return false;
  }
}
