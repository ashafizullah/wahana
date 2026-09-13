import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { WAMessage } from "@/api/types";
import type { MentionResolver } from "@/lib/waMarkdown";
import { stripWaMarkdown } from "@/lib/waMarkdown";

export type ExportFormat = "txt" | "json" | "html";

export function messageLabel(m: WAMessage, resolve: MentionResolver) {
  if (m.fromMe) return "You";
  const d = (m._data ?? {}) as { Info?: { PushName?: string } };
  return resolve(m.participant || m.from) ?? d.Info?.PushName ?? (m.participant || m.from || "").split("@")[0];
}
export function messageKind(m: WAMessage) {
  const msg = ((m._data as { Message?: Record<string, unknown> } | undefined)?.Message ?? {}) as Record<string, unknown>;
  if (msg.stickerMessage) return "[sticker]";
  if (msg.imageMessage) return "[photo]";
  if (msg.videoMessage) return "[video]";
  if (msg.audioMessage) return "[voice]";
  if (msg.documentMessage) return `[document: ${(msg.documentMessage as { fileName?: string }).fileName ?? ""}]`;
  if (m.location) return `[location ${m.location.latitude},${m.location.longitude}]`;
  if (m.vCards?.length) return "[contact]";
  if (Object.keys(msg).some((k) => k.startsWith("pollCreation"))) return "[poll]";
  return m.hasMedia ? "[media]" : "";
}
/** Plain-text transcript (`[date time] Name: text`), oldest first — shared by exports and AI features. */
export function transcript(messages: WAMessage[], resolve: MentionResolver) {
  return [...messages]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((m) => `[${new Date(m.timestamp * 1000).toLocaleString()}] ${messageLabel(m, resolve)}: ${[messageKind(m), m.body].filter(Boolean).join(" ")}`)
    .join("\n");
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Write the loaded messages of a chat to a file chosen by the user. Returns the path or null if cancelled. */
export async function exportChat(chatName: string, messages: WAMessage[], format: ExportFormat, resolve: MentionResolver) {
  const safe = chatName.replace(/[^\w.-]+/g, "_").slice(0, 60) || "chat";
  const path = await save({ defaultPath: `${safe}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
  if (!path) return null;
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  let out: string;
  if (format === "json") {
    out = JSON.stringify(sorted.map((m) => ({ id: m.id, timestamp: m.timestamp, date: new Date(m.timestamp * 1000).toISOString(), from: messageLabel(m, resolve), fromMe: m.fromMe, body: m.body, media: m.hasMedia ? m.media?.mimetype : undefined, kind: messageKind(m) || undefined })), null, 2);
  } else if (format === "txt") {
    out = transcript(sorted, resolve);
  } else {
    out = `<!doctype html><meta charset="utf-8"><title>${esc(chatName)}</title><style>body{font-family:system-ui;max-width:720px;margin:2rem auto;background:#efeae2;padding:0 1rem}.m{max-width:75%;margin:.35rem 0;padding:.4rem .7rem;border-radius:10px;background:#fff;white-space:pre-wrap;word-break:break-word}.me{margin-left:auto;background:#d9fdd3}.h{font-size:.7rem;color:#555}.d{text-align:center;font-size:.75rem;color:#666;margin:1rem 0}</style><h2>${esc(chatName)}</h2>` +
      sorted.map((m, i, a) => {
        const day = new Date(m.timestamp * 1000).toDateString();
        const div = i === 0 || day !== new Date(a[i - 1]!.timestamp * 1000).toDateString() ? `<div class="d">${esc(day)}</div>` : "";
        return `${div}<div class="m${m.fromMe ? " me" : ""}"><div class="h">${esc(messageLabel(m, resolve))} · ${new Date(m.timestamp * 1000).toLocaleTimeString()}</div>${esc([messageKind(m), stripWaMarkdown(m.body || "")].filter(Boolean).join(" "))}</div>`;
      }).join("");
  }
  await writeTextFile(path, out);
  return path;
}
