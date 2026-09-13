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

function config(): AiConfig {
  const s = useSettings.getState();
  return { provider: s.aiProvider, baseUrl: s.aiBaseUrl, model: s.aiModel || DEFAULT_MODELS[s.aiProvider], apiKey: s.aiApiKey };
}

export function aiConfigured() {
  const c = config();
  return !!c.apiKey && !!c.model && (c.provider === "anthropic" || !!c.baseUrl);
}

/** One-shot completion: system + user → text. Routed to the configured provider. */
export async function complete(system: string, user: string, opts: { maxTokens?: number; cfg?: AiConfig } = {}): Promise<string> {
  const c = opts.cfg ?? config();
  if (!c.apiKey) throw new Error("AI API key is not set (Settings → AI).");
  const maxTokens = opts.maxTokens ?? 4096;

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
    p = complete(system, text, { maxTokens: Math.min(8000, Math.max(512, text.length * 3)) });
    translateCache.set(cacheKey, p);
    p.catch(() => translateCache.delete(cacheKey));
  }
  return p;
}

/** Quick connectivity check for the settings page. */
export async function testAi(cfg: AiConfig) {
  const out = await complete("Reply with exactly: OK", "ping", { maxTokens: 16, cfg });
  return out;
}
