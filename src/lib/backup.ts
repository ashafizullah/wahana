import { save, open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import { getVersion } from "@tauri-apps/api/app";
import { nativeWa } from "@/lib/nativeWa";
import { useSettings, type Prefs } from "@/store/settings";
import { getSecret, setSecret } from "@/lib/secrets";
import { db } from "@/store/scheduler";
import { invalidateKbCache, kbConfigured, reindexAll } from "@/lib/knowledge";
import { useChatPrefs, type Takeover } from "@/store/chatPrefs";
import { upsertRule, type AutoReplyRule } from "@/store/autoReply";
import { addSticker, listStickers } from "@/lib/stickers";
import { getThemeMode, setThemeMode, type ThemeMode } from "@/lib/theme";
import type { QuickReply } from "@/store/quickReplies";
import type { Schedule } from "@/store/scheduler";

export interface Backup {
  app: "wahana";
  version: number;
  appVersion: string;
  exportedAt: string;
  prefs: Prefs;
  /** Only when the user opted in — plain text. */
  secrets?: Record<string, string>;
  chatPrefs: {
    pinned: Record<string, number>;
    muted: Record<string, number>;
    archived: Record<string, 1>;
    autoTranslate?: Record<string, { in?: string; out?: string }>;
    takeover?: Record<string, Takeover>;
  };
  quickReplies: QuickReply[];
  schedules: Omit<Schedule, "media_b64">[];
  /** Since backup version 2. */
  autoReplyRules?: AutoReplyRule[];
  theme?: ThemeMode;
  /** Hand-saved tray stickers as base64 WebP (recents are not kept). */
  stickers?: string[];
  /**
   * Native WhatsApp accounts, by id and name only. Their login and chat history are never
   * exported: a restored account pairs again with a QR scan.
   */
  nativeAccounts?: { id: string; name: string }[];
  /** localStorage keys of channels muted here (WhatsApp does not report channel mutes). */
  channelMutes?: string[];
  /** Since backup version 3. Vectors are not exported; "Re-index all" regenerates them after restore. */
  knowledge?: KbDocExport[];
}

/** A knowledge entry as exported: text/table content only, no vectors. */
export interface KbDocExport {
  id: string;
  account: string | null;
  type: "table" | "text";
  title: string;
  columns: string | null;
  rows: string | null;
  text: string | null;
}

const CHANNEL_MUTE_PREFIX = "wa-channel-muted:";

function channelMuteKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(CHANNEL_MUTE_PREFIX) && localStorage.getItem(k) === "1");
  } catch {
    return [];
  }
}

/** Outcome of re-creating one native account: added (needs a QR scan) or already here. */
export interface NativeRestore {
  id: string;
  name: string;
  outcome: "added" | "exists";
}

const BACKUP_VERSION = 3;

const blobToB64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToBlob = (b64: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/webp" });

const PREF_KEYS: (keyof Prefs)[] = [
  "notifications",
  "autoLoadImages",
  "autoLoadStickers",
  "autoLoadVideos",
  "autoLoadAudio",
  "cacheLimitMb",
  "linkPreviews",
  "sendTyping",
  "readReceipts",
  "aiProvider",
  "aiBaseUrl",
  "aiModel",
  "aiFastModel",
  "aiTranslateTo",
  "aiComposeTo",
  "aiSystemPrompt",
  "aiAutoLabel",
  "aiEmbedSameAsChat",
  "aiEmbedBaseUrl",
  "aiEmbedModel",
  "kbEnabled",
  "kbTopK",
  "kbMinScore",
  "autoReplyPaused",
  "autoReplyDailyLimit",
  "autoReplyManualQuietMin",
  "sendTypingByAccount",
  "readReceiptsByAccount",
  "aiPersonaByAccount",
];

export async function exportBackup(includeSecrets: boolean): Promise<string | null> {
  const s = useSettings.getState();
  const nativeAccounts = (await nativeWa.accounts().catch(() => [])).map((a) => ({ id: a.id, name: a.name }));
  const path = await save({
    defaultPath: `wahana-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;
  const chatPrefsStore = await load("chat-prefs.json", { autoSave: true, defaults: {} });
  const d = await db();
  const prefs = Object.fromEntries(PREF_KEYS.map((k) => [k, s[k]])) as unknown as Prefs;
  const backup: Backup = {
    app: "wahana",
    version: BACKUP_VERSION,
    appVersion: await getVersion().catch(() => "dev"),
    exportedAt: new Date().toISOString(),
    prefs,
    chatPrefs: {
      pinned: (await chatPrefsStore.get("pinned")) ?? {},
      muted: (await chatPrefsStore.get("muted")) ?? {},
      archived: (await chatPrefsStore.get("archived")) ?? {},
      autoTranslate: (await chatPrefsStore.get("autoTranslate")) ?? {},
      takeover: (await chatPrefsStore.get("takeover")) ?? {},
    },
    quickReplies: await d.select<QuickReply[]>("SELECT * FROM quick_replies"),
    schedules: await d.select<Omit<Schedule, "media_b64">[]>(
      "SELECT id, account, profile, session, target_type, target_id, target_name, kind, text, media_mime, media_name, next_run, anchor, repeat, weekdays, enabled, created_at, last_run, last_status, last_error, runs FROM schedules",
    ),
    autoReplyRules: await d.select<AutoReplyRule[]>("SELECT * FROM auto_reply_rules"),
    knowledge: await d.select<KbDocExport[]>("SELECT id, account, type, title, columns, rows, text FROM kb_docs"),
    theme: getThemeMode(),
    stickers: await listStickers("saved")
      .then((xs) => Promise.all(xs.map((x) => blobToB64(x.blob))))
      .catch(() => []),
    nativeAccounts,
    channelMutes: channelMuteKeys(),
  };
  if (includeSecrets) {
    const secrets: Record<string, string> = {};
    const ai = await getSecret("ai");
    if (ai) secrets.ai = ai;
    const aiEmbed = await getSecret("ai-embed");
    if (aiEmbed) secrets.aiEmbed = aiEmbed;
    backup.secrets = secrets;
  }
  await writeTextFile(path, JSON.stringify(backup, null, 2));
  return path;
}

export interface RestoreOptions {
  prefs: boolean;
  chatPrefs: boolean;
  quickReplies: boolean;
  schedules: boolean;
  autoReplies: boolean;
  knowledge: boolean;
  stickers: boolean;
  nativeAccounts: boolean;
}

/** Pick a backup file and return its parsed content (validated), or null if cancelled. */
export async function pickBackup(): Promise<{ path: string; backup: Backup } | null> {
  const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path || typeof path !== "string") return null;
  let raw: Backup;
  try {
    raw = JSON.parse(await readTextFile(path)) as Backup;
  } catch {
    throw new Error("Not a Wahana backup file (unreadable JSON).");
  }
  if (raw?.app !== "wahana" || typeof raw.version !== "number") throw new Error("Not a Wahana backup file.");
  if (raw.version > BACKUP_VERSION) throw new Error("This backup was made by a newer version of Wahana. Update the app first.");
  return { path, backup: raw };
}

/** Restores the selected sections; returns what happened to each native account. */
export async function restoreBackup(b: Backup, opts: RestoreOptions): Promise<NativeRestore[]> {
  const s = useSettings.getState();
  // Accounts first, under their original ids, so the account-scoped items below still point at them.
  const native: NativeRestore[] = [];
  if (opts.nativeAccounts && b.nativeAccounts?.length) {
    const here = new Set((await nativeWa.accounts()).map((a) => a.id));
    for (const { id, name } of b.nativeAccounts) {
      if (here.has(id)) native.push({ id, name, outcome: "exists" });
      else {
        await nativeWa.add(id, name);
        native.push({ id, name, outcome: "added" });
      }
    }
  }
  if (opts.prefs && b.prefs) {
    const patch: Partial<Prefs> = {};
    for (const k of PREF_KEYS) if (k in b.prefs) (patch as Record<string, unknown>)[k] = b.prefs[k];
    await s.save(patch);
    if (b.theme) setThemeMode(b.theme);
  }
  if (b.secrets?.ai || b.secrets?.aiEmbed) {
    if (b.secrets.ai) await setSecret("ai", b.secrets.ai);
    if (b.secrets.aiEmbed) await setSecret("ai-embed", b.secrets.aiEmbed);
    await s.hydrate();
  }
  if (opts.chatPrefs && b.chatPrefs) {
    // Merge into the live store (it owns the file and flushes its in-memory state over it).
    const cp = await load("chat-prefs.json", { autoSave: true, defaults: {} });
    const live = useChatPrefs.getState();
    for (const k of ["pinned", "muted", "archived", "autoTranslate", "takeover"] as const) {
      await cp.set(k, { ...live[k], ...(b.chatPrefs[k] ?? {}) });
    }
    await live.hydrate();
    try {
      for (const k of b.channelMutes ?? []) if (k.startsWith(CHANNEL_MUTE_PREFIX)) localStorage.setItem(k, "1");
    } catch {
      /* channel mutes are a convenience */
    }
  }
  const d = await db();
  if (opts.quickReplies && b.quickReplies) {
    for (const r of b.quickReplies) {
      await d.execute(
        "INSERT INTO quick_replies (id, account, shortcut, text, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET account=excluded.account, shortcut=excluded.shortcut, text=excluded.text",
        [r.id, r.account ?? null, r.shortcut, r.text, r.created_at],
      );
    }
  }
  if (opts.schedules && b.schedules) {
    for (const sc of b.schedules) {
      // Attachments are not part of the backup: media jobs come back as text-only (or disabled when they had no text).
      const hadMedia = sc.kind !== "text";
      const kind = "text";
      const enabled = hadMedia && !sc.text ? 0 : sc.enabled;
      await d.execute(
        `INSERT INTO schedules (id, account, profile, session, target_type, target_id, target_name, kind, text, media_mime, media_name, next_run, repeat, weekdays, enabled, created_at, anchor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT(id) DO UPDATE SET account=excluded.account, session=excluded.session, target_type=excluded.target_type, target_id=excluded.target_id, target_name=excluded.target_name, kind=excluded.kind, text=excluded.text, media_mime=NULL, media_name=NULL, next_run=excluded.next_run, repeat=excluded.repeat, weekdays=excluded.weekdays, enabled=excluded.enabled, anchor=excluded.anchor`,
        [
          sc.id,
          sc.account,
          sc.profile,
          sc.session,
          sc.target_type,
          sc.target_id,
          sc.target_name,
          kind,
          sc.text,
          null,
          null,
          sc.next_run,
          sc.repeat,
          sc.weekdays,
          enabled,
          sc.created_at,
          sc.anchor ?? null,
        ],
      );
    }
  }
  if (opts.autoReplies && b.autoReplyRules) {
    for (const r of b.autoReplyRules) await upsertRule(r);
  }
  if (opts.knowledge && b.knowledge) {
    const now = Math.floor(Date.now() / 1000);
    for (const k of b.knowledge) {
      // Vectors are not in the backup: drop any existing ones and mark the entry for re-indexing.
      await d.execute("DELETE FROM kb_chunks WHERE doc_id = $1", [k.id]);
      await d.execute(
        `INSERT INTO kb_docs (id, account, type, title, columns, rows, text, embed_model, status, error, chunk_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,'new',NULL,0,$8,$9)
         ON CONFLICT(id) DO UPDATE SET account=excluded.account, type=excluded.type, title=excluded.title, columns=excluded.columns,
           rows=excluded.rows, text=excluded.text, embed_model=NULL, status='new', error=NULL, chunk_count=0, updated_at=excluded.updated_at`,
        [k.id, k.account ?? null, k.type, k.title, k.columns, k.rows, k.text, now, now],
      );
    }
    invalidateKbCache();
    // Prefs and keys were restored above, so embeddings may already be usable: rebuild the vectors in
    // the background instead of leaving every entry silently unused until "Re-index all".
    if (b.knowledge.length && kbConfigured()) void reindexAll().catch((e) => console.warn("knowledge re-index after restore failed", e));
  }
  if (opts.stickers && b.stickers) {
    for (const s64 of b.stickers) await addSticker(b64ToBlob(s64), "saved");
  }
  return native;
}
