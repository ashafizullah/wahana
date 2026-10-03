import { Toggle } from "./shared";
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, XCircle } from "lucide-react";
import { DEFAULT_MODELS, LANGUAGES, embedOne, testAi } from "@/lib/ai";
import { useSettings } from "@/store/settings";
import { useAccounts } from "@/lib/account";
import { Button, Input, Label } from "@/components/ui";
import { errMsg } from "@/lib/utils";

export function AiSection() {
  const s = useSettings();
  const [provider, setProvider] = useState(s.aiProvider);
  const [baseUrl, setBaseUrl] = useState(s.aiBaseUrl);
  const [model, setModel] = useState(s.aiModel);
  const [fastModel, setFastModel] = useState(s.aiFastModel);
  const [embedModel, setEmbedModel] = useState(s.aiEmbedModel);
  const [embedSame, setEmbedSame] = useState(s.aiEmbedSameAsChat);
  const [embedBaseUrl, setEmbedBaseUrl] = useState(s.aiEmbedBaseUrl);
  const [embedKey, setEmbedKey] = useState(s.aiEmbedApiKey);
  const [key, setKey] = useState(s.aiApiKey);
  const [persona, setPersona] = useState(s.aiSystemPrompt);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setProvider(s.aiProvider);
    setBaseUrl(s.aiBaseUrl);
    setModel(s.aiModel);
    setFastModel(s.aiFastModel);
    setEmbedModel(s.aiEmbedModel);
    setEmbedSame(s.aiEmbedSameAsChat);
    setEmbedBaseUrl(s.aiEmbedBaseUrl);
    setEmbedKey(s.aiEmbedApiKey);
    setKey(s.aiApiKey);
    setPersona(s.aiSystemPrompt);
  }, [
    s.aiProvider,
    s.aiBaseUrl,
    s.aiModel,
    s.aiFastModel,
    s.aiEmbedModel,
    s.aiEmbedSameAsChat,
    s.aiEmbedBaseUrl,
    s.aiEmbedApiKey,
    s.aiApiKey,
    s.aiSystemPrompt,
  ]);
  const dirty =
    provider !== s.aiProvider ||
    baseUrl.trim() !== s.aiBaseUrl ||
    model.trim() !== s.aiModel ||
    fastModel.trim() !== s.aiFastModel ||
    embedModel.trim() !== s.aiEmbedModel ||
    embedSame !== s.aiEmbedSameAsChat ||
    embedBaseUrl.trim() !== s.aiEmbedBaseUrl ||
    embedKey.trim() !== s.aiEmbedApiKey ||
    key.trim() !== s.aiApiKey ||
    persona.trim() !== s.aiSystemPrompt;
  const cfg = { provider, baseUrl: baseUrl.trim(), model: model.trim() || DEFAULT_MODELS[provider], apiKey: key.trim() };
  const embedCfg = embedSame
    ? { baseUrl: cfg.baseUrl, model: embedModel.trim(), apiKey: cfg.apiKey }
    : { baseUrl: embedBaseUrl.trim().replace(/\/+$/, ""), model: embedModel.trim(), apiKey: embedKey.trim() };

  return (
    <>
      <div>
        <Label>Provider</Label>
        <div className="flex gap-1">
          {(
            [
              ["anthropic", "Anthropic (Claude)"],
              ["openai-compatible", "OpenAI-compatible"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={provider === id ? "primary" : "secondary"}
              onClick={() => {
                setProvider(id);
                if (!model || model === DEFAULT_MODELS[provider]) setModel(DEFAULT_MODELS[id]);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div>
        <Label>
          {provider === "anthropic"
            ? "Base URL (optional — leave empty for api.anthropic.com)"
            : "Base URL (e.g. https://api.tokenrouter.com/v1)"}
        </Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={provider === "anthropic" ? "https://api.anthropic.com" : "https://…/v1"}
          spellCheck={false}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Model</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={provider === "anthropic" ? "claude-opus-5" : "e.g. gpt-4.1-mini, llama3"}
            spellCheck={false}
          />
        </div>
        <div>
          <Label>API key</Label>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" />
        </div>
      </div>
      <div>
        <Label>Fast model — used for translate, rewrite and smart replies (optional; empty = same as Model)</Label>
        <Input
          value={fastModel}
          onChange={(e) => setFastModel(e.target.value)}
          placeholder={provider === "anthropic" ? "claude-haiku-4-5" : "e.g. gpt-4.1-nano, llama3.2"}
          spellCheck={false}
        />
        <p className="text-[11px] text-neutral-500 mt-1">
          Short edits don't need the strongest model. A small model answers in ~1–2 s; summaries keep using Model above.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <div>
          <Label>Embedding model — knowledge base (optional)</Label>
          <Input
            value={embedModel}
            onChange={(e) => setEmbedModel(e.target.value)}
            placeholder="text-embedding-3-small, nomic-embed-text"
            spellCheck={false}
          />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={embedSame} onChange={(e) => setEmbedSame(e.target.checked)} /> Same endpoint &amp; key as chat
        </label>
      </div>
      {!embedSame && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Embedding base URL</Label>
            <Input
              value={embedBaseUrl}
              onChange={(e) => setEmbedBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </div>
          <div>
            <Label>Embedding API key</Label>
            <Input type="password" value={embedKey} onChange={(e) => setEmbedKey(e.target.value)} placeholder="sk-…" />
          </div>
        </div>
      )}
      {embedSame && provider === "anthropic" && !!embedModel.trim() && (
        <div className="text-[11px] text-amber-700 dark:text-amber-300">
          Anthropic serves no embeddings API — uncheck the box to point embeddings at a separate OpenAI-compatible endpoint.
        </div>
      )}
      <p className="text-[11px] text-neutral-500">
        Powers the knowledge base (Features → Knowledge), used by AI auto-replies. Empty model = knowledge base disabled.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>My language</Label>
          <select
            value={s.aiTranslateTo}
            onChange={(e) => s.save({ aiTranslateTo: e.target.value })}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none"
          >
            {LANGUAGES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-neutral-500 mt-1">
            The language you read and write in. Incoming messages are translated into it; summaries, image descriptions and AI drafts are
            written in it.
          </p>
        </div>
        <div>
          <Label>Target language</Label>
          <select
            value={s.aiComposeTo}
            onChange={(e) => s.save({ aiComposeTo: e.target.value })}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none"
          >
            {LANGUAGES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-neutral-500 mt-1">
            The language the other side reads. Only used for translating: the 🌐 button in the composer and per-chat auto-translate (chat
            menu ⋮ → Auto-translate).
          </p>
        </div>
      </div>
      <div>
        <Label>Persona — who you are, your business, preferred tone (used by summaries, smart replies and the writing assistant)</Label>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          rows={3}
          placeholder={
            'e.g. I\'m Adam, owner of Toko Wahana (electronics, Bandung). Reply in Indonesian, casual but polite; address customers as "Kak". Never promise delivery dates.'
          }
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-wa-dark resize-y"
        />
      </div>
      <PersonaPerAccount />
      <Toggle
        label="Label new chats automatically"
        hint="When a direct chat that has no label yet receives a message, ask the AI which of your existing labels fit (lead, complaint, supplier…) and assign them. One request per new chat; never creates labels."
        checked={s.aiAutoLabel}
        onChange={(v) => s.save({ aiAutoLabel: v })}
      />
      {result && (
        <div
          className={
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm " +
            (result.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300")
          }
        >
          {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span className="selectable break-all">{result.text}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={busy !== null || !cfg.apiKey || !cfg.model || (provider !== "anthropic" && !cfg.baseUrl)}
          onClick={async () => {
            setBusy("test");
            setResult(null);
            try {
              const out = await testAi(cfg);
              const text = `Model replied: ${out.slice(0, 80)}`;
              if (embedModel.trim()) {
                try {
                  const vec = await embedOne("ping", embedCfg);
                  setResult({ ok: true, text: `${text} · embeddings OK (${vec.length} dims)` });
                } catch (e) {
                  setResult({ ok: false, text: `Chat OK, but embeddings failed: ${errMsg(e)}` });
                }
              } else {
                setResult({ ok: true, text });
              }
            } catch (e) {
              setResult({ ok: false, text: errMsg(e) });
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "test" && <Loader2 size={14} className="animate-spin" />} Test
        </Button>
        <Button
          disabled={busy !== null || !dirty}
          onClick={async () => {
            setBusy("save");
            try {
              await s.save({
                aiProvider: provider,
                aiBaseUrl: cfg.baseUrl,
                aiModel: cfg.model,
                aiFastModel: fastModel.trim(),
                aiEmbedModel: embedModel.trim(),
                aiEmbedSameAsChat: embedSame,
                aiEmbedBaseUrl: embedBaseUrl.trim(),
                aiEmbedApiKey: embedKey.trim(),
                aiApiKey: cfg.apiKey,
                aiSystemPrompt: persona.trim(),
              });
              setResult({ ok: true, text: "Saved." });
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "save" && <Loader2 size={14} className="animate-spin" />} Save
        </Button>
      </div>
    </>
  );
}

/** Persona overrides per account (by native number). Saved on blur. */
function PersonaPerAccount() {
  const accounts = useAccounts();
  const map = useSettings((s) => s.aiPersonaByAccount);
  const save = useSettings((s) => s.save);
  const [open, setOpen] = useState(false);
  const overridden = Object.values(map).filter((v) => v?.trim()).length;
  if (accounts.length < 2 && overridden === 0) return null;
  const set = (key: string, text: string) => {
    const next = { ...map };
    if (text.trim()) next[key] = text;
    else delete next[key];
    void save({ aiPersonaByAccount: next });
  };
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm" onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={14} className={open ? "" : "-rotate-90"} />
        <span className="font-medium">Persona per account</span>
        <span className="text-xs text-neutral-500">
          {overridden ? `${overridden} override${overridden > 1 ? "s" : ""}` : "none — every account uses the persona above"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-[11px] text-neutral-500">
            Running several businesses from one app? Give each number its own "who I am". Empty = use the default persona. Applies to
            auto-reply, smart replies, the writing assistant and summaries for chats on that account.
          </p>
          {accounts.map((a) => (
            <PersonaField key={a.key} name={a.label} value={map[a.key] ?? ""} onSave={(t) => set(a.key, t)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonaField({ name, value, onSave }: { name: string; value: string; onSave: (t: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div>
      <Label>{name}</Label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value.trim() && onSave(text)}
        rows={2}
        placeholder="(uses the default persona)"
        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-wa-dark resize-y"
      />
    </div>
  );
}
