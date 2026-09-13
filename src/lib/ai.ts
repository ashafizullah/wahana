import Anthropic from "@anthropic-ai/sdk";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useSettings } from "@/store/settings";

export type AiProvider = "anthropic" | "openai-compatible";

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string; // OpenAI-compatible: required; Anthropic: optional override
  model: string;
  apiKey: string;
}

export const DEFAULT_MODELS: Record<AiProvider, string> = { anthropic: "claude-opus-5", "openai-compatible": "" };

export const LANGUAGES = [
  ["id", "Indonesian"], ["en", "English"], ["ms", "Malay"], ["ar", "Arabic"], ["zh", "Chinese (Simplified)"], ["zh-TW", "Chinese (Traditional)"],
  ["ja", "Japanese"], ["ko", "Korean"], ["hi", "Hindi"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"],
  ["ru", "Russian"], ["it", "Italian"], ["tr", "Turkish"], ["vi", "Vietnamese"], ["th", "Thai"], ["nl", "Dutch"], ["jv", "Javanese"],
] as const;
export const langName = (code: string) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code;

function config(fast = false): AiConfig {
  const s = useSettings.getState();
  const model = (fast && s.aiFastModel.trim()) || s.aiModel || DEFAULT_MODELS[s.aiProvider];
  return { provider: s.aiProvider, baseUrl: s.aiBaseUrl, model, apiKey: s.aiApiKey };
}

export function aiConfigured() {
  const c = config();
  return !!c.apiKey && !!c.model && (c.provider === "anthropic" || !!c.baseUrl);
}

/** The user's persona from Settings → AI, as a system-prompt preamble (empty when unset). */
export function personaPreamble() {
  const p = useSettings.getState().aiSystemPrompt.trim();
  return p ? `About the user you are assisting (follow these standing instructions):\n${p}\n\n` : "";
}

/**
 * One-shot completion: system + user → text. Routed to the configured provider.
 * `persona` (default true) prepends Settings → AI → Persona; `fast` picks the fast model when one is set.
 */
export async function complete(system: string, user: string, opts: { maxTokens?: number; cfg?: AiConfig; persona?: boolean; fast?: boolean } = {}): Promise<string> {
  const c = opts.cfg ?? config(opts.fast);
  if (!c.apiKey) throw new Error("AI API key is not set (Settings → AI).");
  const maxTokens = opts.maxTokens ?? 4096;
  if (opts.persona !== false) system = personaPreamble() + system;

  if (c.provider === "anthropic") {
    const client = new Anthropic({
      apiKey: c.apiKey,
      baseURL: c.baseUrl.trim() || undefined,
      fetch: tauriFetch as unknown as typeof fetch, // bypass webview CORS
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
    });
    const res = await client.messages.create({
      model: c.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low" },
    });
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
  }

  // OpenAI-compatible chat completions (routers, Ollama, etc.)
  const base = c.baseUrl.replace(/\/+$/, "");
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  const res = await tauriFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({ model: c.model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      msg = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? msg;
    } catch {
      /* keep */
    }
    throw new Error(msg);
  }
  const j = JSON.parse(text) as { choices?: { message?: { content?: string | { text?: string }[] } }[] };
  const content = j.choices?.[0]?.message?.content;
  const out = typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? "").join("");
  return out.trim();
}

const translateCache = new Map<string, Promise<string>>();

/** Translate `text` into `target` (language name or code). Keeps WhatsApp formatting and emoji. */
export function translate(text: string, target: string, key?: string) {
  const cacheKey = `${target}:${key ?? text}`;
  let p = translateCache.get(cacheKey);
  if (!p) {
    const system = `You are a translator inside a chat app. Translate the user's message into ${langName(target)}.
Rules: output only the translation, no explanations or quotes. Preserve line breaks, emoji, URLs, @mentions, phone numbers and WhatsApp formatting markers (*bold*, _italic_, ~strike~, \`\`\`code\`\`\`). Keep the tone and register (casual/formal). If the text is already in ${langName(target)}, return it unchanged.`;
    p = complete(system, text, { maxTokens: Math.min(8000, Math.max(512, text.length * 3)), persona: false, fast: true });
    translateCache.set(cacheKey, p);
    p.catch(() => translateCache.delete(cacheKey));
  }
  return p;
}

/** Quick connectivity check for the settings page. */
export async function testAi(cfg: AiConfig) {
  const out = await complete("Reply with exactly: OK", "ping", { maxTokens: 16, cfg, persona: false });
  return out;
}

/** Summarize a chat transcript (see `transcript()` in exportChat.ts). Output uses WhatsApp formatting so it renders with WaMarkdown. */
export function summarizeChat(text: string, opts: { chatName: string; isGroup: boolean; language: string; question?: string }) {
  const system = `You summarize WhatsApp conversations for the user, who appears in the transcript as "You". This is a ${opts.isGroup ? "group chat" : "private chat"} named "${opts.chatName}".
Write in ${langName(opts.language)}. Format with WhatsApp markup only: *bold* for section titles, "- " bullets, no Markdown headings (#), no tables, no code blocks.
${opts.question ? `Answer the user's question using only the transcript. If the transcript does not contain the answer, say so briefly.` : `Sections (omit a section if empty):
*Ringkasan* / *Summary* — 2–4 sentences on what the conversation was about.
*Keputusan* / *Decisions* — things agreed or concluded.
*Tugas & tenggat* / *Action items* — who has to do what, with dates/amounts if mentioned.
*Pertanyaan terbuka* / *Open questions* — things still waiting for an answer, especially ones addressed to You.
Use the section titles in the output language. Attribute statements to people by name. Be concise; keep the facts, drop the small talk. Media appears as [photo], [voice], etc. — mention it only when relevant.`}`;
  const user = opts.question ? `Question: ${opts.question}\n\nTranscript:\n${text}` : `Transcript:\n${text}`;
  return complete(system, user, { maxTokens: 2048 });
}

export const REWRITE_MODES = [
  ["fix", "Fix grammar & typos"],
  ["formal", "Make it formal"],
  ["casual", "Make it casual"],
  ["friendly", "Make it friendlier"],
  ["shorter", "Make it shorter"],
  ["longer", "Expand it"],
  ["bullets", "Turn into bullet points"],
] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number][0];

const REWRITE_INSTRUCTIONS: Record<RewriteMode, string> = {
  fix: "Fix spelling, grammar and punctuation only. Do not change the wording, tone or meaning.",
  formal: "Rewrite in a polite, professional register suitable for a business contact. Keep the meaning.",
  casual: "Rewrite in a relaxed, everyday chat register, like texting a friend. Keep the meaning.",
  friendly: "Rewrite so it sounds warm and friendly without becoming long. Keep the meaning.",
  shorter: "Rewrite as briefly as possible while keeping every piece of information.",
  longer: "Expand with a little more context and courtesy so it reads complete; do not invent facts.",
  bullets: "Restructure as a short list using \"- \" bullets, one point per line; keep a one-line lead-in if needed.",
};

/** Rewrite a draft in the composer. Keeps the draft's language and WhatsApp formatting. */
export function rewriteDraft(text: string, mode: RewriteMode) {
  const system = `You edit a WhatsApp message the user is about to send. ${REWRITE_INSTRUCTIONS[mode]}
Rules: reply with the rewritten message only — no preamble, quotes or explanations. Keep the same language as the draft. Preserve emoji, URLs, @mentions, phone numbers, line breaks and WhatsApp formatting markers (*bold*, _italic_, ~strike~, \`\`\`code\`\`\`) where they make sense.`;
  return complete(system, text, { maxTokens: Math.min(4000, Math.max(256, text.length * 3)), fast: true });
}

/** Three short reply suggestions for the current conversation (transcript from `transcript()`). Returns [] when the model output is unusable. */
export async function smartReplies(text: string, opts: { chatName: string; isGroup: boolean }): Promise<string[]> {
  const system = `You suggest replies the user ("You" in the transcript) could send next in a ${opts.isGroup ? "WhatsApp group" : "WhatsApp chat"} named "${opts.chatName}".
Return exactly 3 suggestions as a JSON array of strings and nothing else. Each suggestion: one complete message the user could send as-is, ≤ 25 words, in the same language and register the user writes in (or the other party, if the user hasn't written yet). Make them meaningfully different (e.g. agree / ask a follow-up / decline politely). Answer the latest incoming message; use facts from the transcript, never invent commitments, prices or dates. No numbering, no quotes around the array.`;
  const raw = await complete(system, `Transcript (latest last):\n${text}`, { maxTokens: 400, fast: true });
  const m = raw.match(/\[[\s\S]*\]/);
  try {
    const arr = JSON.parse(m ? m[0] : raw) as unknown;
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 3);
  } catch {
    /* fall through */
  }
  return raw.split("\n").map((l) => l.replace(/^\s*(?:[-*\d.)]+\s*)?/, "").trim()).filter(Boolean).slice(0, 3);
}
