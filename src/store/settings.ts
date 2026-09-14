import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { WahaClient } from "@/api/client";
import { deleteSecret, getSecret, setSecret } from "@/lib/secrets";

const STORE_FILE = "settings.json";

let storePromise: Promise<Store> | null = null;
function store() {
  storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} });
  return storePromise;
}

/** A WAHA server the user can switch between. The API key lives in the keychain under `profile.id`. */
export interface Profile {
  id: string;
  name: string;
  baseUrl: string;
  session: string;
}

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
  readReceipts: "always" | "on-reply" | "manual" | "never";
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
  /** Kill switch for all auto-reply rules. */
  autoReplyPaused: boolean;
  /** Max auto-replies sent per calendar day across all rules of this server (0 = unlimited). Spend guard for AI replies. */
  autoReplyDailyLimit: number;
  /** Persona overrides per WAHA session, keyed "profileId:session"; missing or empty = use aiSystemPrompt. */
  aiPersonaBySession: Record<string, string>;
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
  aiProvider: "anthropic",
  aiBaseUrl: "",
  aiModel: "claude-opus-5",
  aiFastModel: "",
  aiTranslateTo: "id",
  aiComposeTo: "en",
  aiSystemPrompt: "",
  autoReplyPaused: false,
  autoReplyDailyLimit: 300,
  aiPersonaBySession: {},
};

interface SettingsState extends Prefs {
  hydrated: boolean;
  /** AI provider key (keychain entry "ai"). */
  aiApiKey: string;
  profiles: Profile[];
  activeProfile: string;
  /** Derived from the active profile (kept flat for convenience). */
  baseUrl: string;
  session: string;
  apiKey: string;
  client: WahaClient | null;

  hydrate: () => Promise<void>;
  /** Update prefs and/or the active profile's connection (baseUrl, session, apiKey). */
  save: (patch: Partial<Prefs & { baseUrl: string; session: string; apiKey: string; name: string; aiApiKey: string }>) => Promise<void>;
  addProfile: (p: { name: string; baseUrl: string; apiKey: string; session?: string }) => Promise<void>;
  switchProfile: (id: string) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

function makeClient(baseUrl: string, apiKey: string) {
  return baseUrl && apiKey ? new WahaClient({ baseUrl, apiKey }) : null;
}

const readKey = (profileId: string) => getSecret(profileId);

const newId = () => Math.random().toString(36).slice(2, 10);

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_PREFS,
  hydrated: false,
  aiApiKey: "",
  profiles: [],
  activeProfile: "",
  baseUrl: "",
  session: "default",
  apiKey: "",
  client: null,

  async hydrate() {
    const s = await store();
    const prefs = { ...DEFAULT_PREFS };
    for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
      const v = await s.get<Prefs[typeof k]>(k);
      if (v !== undefined && v !== null) (prefs as Record<string, unknown>)[k] = v;
    }
    const legacyReceipts = await s.get<boolean>("sendReadReceipts");
    if (legacyReceipts === false) prefs.readReceipts = "never";
    let profiles = (await s.get<Profile[]>("profiles")) ?? [];
    let active = (await s.get<string>("activeProfile")) ?? "";

    // Migrate the single-server layout (baseUrl/session at top level, key under "default").
    const legacyUrl = await s.get<string>("baseUrl");
    if (profiles.length === 0 && legacyUrl) {
      profiles = [{ id: "default", name: "Default", baseUrl: legacyUrl, session: (await s.get<string>("session")) ?? "default" }];
      active = "default";
      await s.set("profiles", profiles);
      await s.set("activeProfile", active);
      await s.delete("baseUrl");
      await s.delete("session");
    }

    let apiKey = "";
    // Dev convenience: prefill from .env.development.local when nothing is stored yet.
    if (import.meta.env.DEV && profiles.length === 0 && import.meta.env.VITE_WAHA_BASE_URL) {
      profiles = [{ id: "dev", name: "Dev", baseUrl: import.meta.env.VITE_WAHA_BASE_URL, session: import.meta.env.VITE_WAHA_SESSION ?? "default" }];
      active = "dev";
      apiKey = import.meta.env.VITE_WAHA_API_KEY ?? "";
    }
    if (!profiles.some((p) => p.id === active)) active = profiles[0]?.id ?? "";
    const prof = profiles.find((p) => p.id === active);
    if (prof && !apiKey) apiKey = await readKey(prof.id);
    // Dev: every cargo rebuild is a new binary, so macOS may deny keychain access until re-approved.
    // Fall back to the dev key when the profile points at the dev server.
    if (import.meta.env.DEV && prof && !apiKey && import.meta.env.VITE_WAHA_API_KEY && prof.baseUrl.replace(/\/+$/, "") === (import.meta.env.VITE_WAHA_BASE_URL ?? "").replace(/\/+$/, "")) {
      apiKey = import.meta.env.VITE_WAHA_API_KEY;
    }

    const aiApiKey = await getSecret("ai");
    set({
      hydrated: true,
      ...prefs,
      aiApiKey,
      profiles,
      activeProfile: active,
      baseUrl: prof?.baseUrl ?? "",
      session: prof?.session ?? "default",
      apiKey,
      client: makeClient(prof?.baseUrl ?? "", apiKey),
    });
  },

  async save(patch) {
    const s = await store();
    const { apiKey: newKey, baseUrl, session, name, aiApiKey, ...prefPatch } = patch;
    for (const [k, v] of Object.entries(prefPatch)) await s.set(k, v);
    if (aiApiKey !== undefined) {
      await setSecret("ai", aiApiKey.trim());
      set({ aiApiKey: aiApiKey.trim() });
    }

    const st = get();
    let profiles = st.profiles;
    let active = st.activeProfile;
    let apiKey = st.apiKey;

    if (baseUrl !== undefined || session !== undefined || newKey !== undefined || name !== undefined) {
      // No profile yet (first-run Save) → create one.
      if (!profiles.some((p) => p.id === active)) {
        active = newId();
        profiles = [...profiles, { id: active, name: name ?? "Default", baseUrl: "", session: "default" }];
      }
      profiles = profiles.map((p) =>
        p.id === active
          ? {
              ...p,
              name: name?.trim() || p.name,
              baseUrl: baseUrl !== undefined ? baseUrl.trim() : p.baseUrl,
              session: session !== undefined ? session.trim() : p.session,
            }
          : p,
      );
      await s.set("profiles", profiles);
      await s.set("activeProfile", active);
      if (newKey !== undefined) {
        apiKey = newKey.trim();
        await setSecret(active, apiKey);
      }
    }
    const prof = profiles.find((p) => p.id === active);
    const nextUrl = prof?.baseUrl ?? "";
    set({
      ...prefPatch,
      profiles,
      activeProfile: active,
      baseUrl: nextUrl,
      session: prof?.session ?? "default",
      apiKey,
      client: baseUrl !== undefined || newKey !== undefined ? makeClient(nextUrl, apiKey) : st.client,
    });
  },

  async addProfile({ name, baseUrl, apiKey, session = "default" }) {
    const s = await store();
    const id = newId();
    const profiles = [...get().profiles, { id, name: name.trim() || baseUrl, baseUrl: baseUrl.trim(), session }];
    await s.set("profiles", profiles);
    await setSecret(id, apiKey.trim());
    set({ profiles });
    await get().switchProfile(id);
  },

  async switchProfile(id) {
    const prof = get().profiles.find((p) => p.id === id);
    if (!prof) return;
    const s = await store();
    await s.set("activeProfile", id);
    const apiKey = await readKey(id);
    set({ activeProfile: id, baseUrl: prof.baseUrl, session: prof.session, apiKey, client: makeClient(prof.baseUrl, apiKey) });
  },

  async removeProfile(id) {
    const s = await store();
    const profiles = get().profiles.filter((p) => p.id !== id);
    await s.set("profiles", profiles);
    await deleteSecret(id);
    set({ profiles });
    if (get().activeProfile === id) {
      if (profiles[0]) await get().switchProfile(profiles[0].id);
      else set({ activeProfile: "", baseUrl: "", session: "default", apiKey: "", client: null });
    }
  },

  async clear() {
    const s = await store();
    for (const p of get().profiles) await deleteSecret(p.id);
    await deleteSecret("ai");
    await s.clear();
    set({ ...DEFAULT_PREFS, profiles: [], activeProfile: "", baseUrl: "", session: "default", apiKey: "", client: null });
  },
}));

/** Convenience: throws if settings are incomplete. Use inside query fns. */
export function requireClient() {
  const c = useSettings.getState().client;
  if (!c) throw new Error("WAHA is not configured");
  return c;
}

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

/** Mimetype prefixes WAHA should pre-download server-side for message lists. */
export function autoLoadMimePrefixes(p: MediaPrefs) {
  const out: string[] = [];
  if (p.autoLoadImages) out.push("image/");
  else if (p.autoLoadStickers) out.push("image/webp"); // stickers are webp; plain webp photos are rare
  if (p.autoLoadVideos) out.push("video/");
  if (p.autoLoadAudio) out.push("audio/");
  return out;
}
