import { save, open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import { getVersion } from "@tauri-apps/api/app";
import { useSettings, type Prefs, type Profile } from "@/store/settings";
import { getSecret, setSecret } from "@/lib/secrets";
import { db } from "@/store/scheduler";
import type { QuickReply } from "@/store/quickReplies";
import type { Schedule } from "@/store/scheduler";

export interface Backup {
  app: "wahana";
  version: number;
  appVersion: string;
  exportedAt: string;
  prefs: Prefs;
  profiles: Profile[];
  activeProfile: string;
  /** Only when the user opted in — plain text. */
  secrets?: Record<string, string>;
  chatPrefs: { pinned: Record<string, number>; muted: Record<string, 1>; archived: Record<string, 1>; autoTranslate?: Record<string, { in?: string; out?: string }> };
  quickReplies: QuickReply[];
  schedules: Omit<Schedule, "media_b64">[];
}

const PREF_KEYS: (keyof Prefs)[] = [
  "notifications", "autoLoadImages", "autoLoadStickers", "autoLoadVideos", "autoLoadAudio", "cacheLimitMb", "linkPreviews",
  "sendTyping", "readReceipts", "aiProvider", "aiBaseUrl", "aiModel", "aiFastModel", "aiTranslateTo", "aiComposeTo", "aiSystemPrompt", "autoReplyPaused", "aiPersonaBySession",
];

export async function exportBackup(includeSecrets: boolean): Promise<string | null> {
  const s = useSettings.getState();
  const path = await save({ defaultPath: `wahana-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path) return null;
  const chatPrefsStore = await load("chat-prefs.json", { autoSave: true, defaults: {} });
  const d = await db();
  const prefs = Object.fromEntries(PREF_KEYS.map((k) => [k, s[k]])) as unknown as Prefs;
  const backup: Backup = {
    app: "wahana",
    version: 1,
    appVersion: await getVersion().catch(() => "dev"),
    exportedAt: new Date().toISOString(),
    prefs,
    profiles: s.profiles,
    activeProfile: s.activeProfile,
    chatPrefs: {
      pinned: (await chatPrefsStore.get("pinned")) ?? {},
      muted: (await chatPrefsStore.get("muted")) ?? {},
      archived: (await chatPrefsStore.get("archived")) ?? {},
      autoTranslate: (await chatPrefsStore.get("autoTranslate")) ?? {},
    },
    quickReplies: await d.select<QuickReply[]>("SELECT * FROM quick_replies"),
    schedules: await d.select<Omit<Schedule, "media_b64">[]>(
      "SELECT id, profile, session, target_type, target_id, target_name, kind, text, media_mime, media_name, next_run, repeat, weekdays, enabled, created_at, last_run, last_status, last_error, runs FROM schedules",
    ),
  };
  if (includeSecrets) {
    const secrets: Record<string, string> = {};
    for (const p of s.profiles) {
      const k = await getSecret(p.id);
      if (k) secrets[p.id] = k;
    }
    const ai = await getSecret("ai");
    if (ai) secrets.ai = ai;
    backup.secrets = secrets;
  }
  await writeTextFile(path, JSON.stringify(backup, null, 2));
  return path;
}

export interface RestoreOptions {
  prefs: boolean;
  profiles: boolean;
  chatPrefs: boolean;
  quickReplies: boolean;
  schedules: boolean;
}

/** Pick a backup file and return its parsed content (validated), or null if cancelled. */
export async function pickBackup(): Promise<{ path: string; backup: Backup } | null> {
  const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path || typeof path !== "string") return null;
  const raw = JSON.parse(await readTextFile(path)) as Backup;
  if (raw.app !== "wahana" || typeof raw.version !== "number") throw new Error("Not a Wahana backup file.");
  return { path, backup: raw };
}

export async function restoreBackup(b: Backup, opts: RestoreOptions) {
  const s = useSettings.getState();
  if (opts.prefs && b.prefs) {
    const patch: Partial<Prefs> = {};
    for (const k of PREF_KEYS) if (k in b.prefs) (patch as Record<string, unknown>)[k] = b.prefs[k];
    await s.save(patch);
  }
  if (opts.profiles && b.profiles) {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    // Merge by id: keep existing profiles, add/overwrite the imported ones.
    const merged = [...s.profiles.filter((p) => !b.profiles.some((x) => x.id === p.id)), ...b.profiles];
    await store.set("profiles", merged);
    if (b.secrets) for (const [id, key] of Object.entries(b.secrets)) await setSecret(id, key);
    await store.set("activeProfile", merged.some((p) => p.id === b.activeProfile) ? b.activeProfile : merged[0]?.id ?? "");
    await s.hydrate();
  } else if (b.secrets?.ai) {
    await setSecret("ai", b.secrets.ai);
    await s.hydrate();
  }
  if (opts.chatPrefs && b.chatPrefs) {
    const cp = await load("chat-prefs.json", { autoSave: true, defaults: {} });
    await cp.set("pinned", b.chatPrefs.pinned ?? {});
    await cp.set("muted", b.chatPrefs.muted ?? {});
    await cp.set("archived", b.chatPrefs.archived ?? {});
    await cp.set("autoTranslate", b.chatPrefs.autoTranslate ?? {});
  }
  const d = await db();
  if (opts.quickReplies && b.quickReplies) {
    for (const r of b.quickReplies) {
      await d.execute(
        "INSERT INTO quick_replies (id, profile, session, shortcut, text, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET session=excluded.session, shortcut=excluded.shortcut, text=excluded.text",
        [r.id, r.profile, r.session ?? null, r.shortcut, r.text, r.created_at],
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
        `INSERT INTO schedules (id, profile, session, target_type, target_id, target_name, kind, text, media_mime, media_name, next_run, repeat, weekdays, enabled, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT(id) DO UPDATE SET session=excluded.session, target_type=excluded.target_type, target_id=excluded.target_id, target_name=excluded.target_name, kind=excluded.kind, text=excluded.text, next_run=excluded.next_run, repeat=excluded.repeat, weekdays=excluded.weekdays, enabled=excluded.enabled`,
        [sc.id, sc.profile, sc.session, sc.target_type, sc.target_id, sc.target_name, kind, sc.text, null, null, sc.next_run, sc.repeat, sc.weekdays, enabled, sc.created_at],
      );
    }
  }
}
