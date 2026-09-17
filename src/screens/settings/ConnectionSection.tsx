import { useEffect, useState } from "react";
import { confirm } from "@/components/Confirm";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { WahaClient } from "@/api/client";
import { Button, Input, Label } from "@/components/ui";
import { errMsg } from "@/lib/utils";

export function ConnectionSection({ onSaved }: { onSaved: () => void }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const activeName = settings.profiles.find((p) => p.id === settings.activeProfile)?.name ?? "";
  const [name, setName] = useState(activeName);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setApiKey(settings.apiKey);
    setName(activeName);
    setResult(null);
  }, [settings.activeProfile, settings.baseUrl, settings.apiKey, activeName]);

  const dirty = baseUrl.trim() !== settings.baseUrl || apiKey.trim() !== settings.apiKey || name.trim() !== activeName;

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const v = await new WahaClient({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }).serverVersion();
      setResult({ ok: true, text: `WAHA ${v.version} · ${v.engine} · ${v.tier}` });
    } catch (e) {
      setResult({ ok: false, text: errMsg(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await settings.save({ baseUrl, apiKey, name: name || undefined });
      qc.clear();
      onSaved();
    } catch (e) {
      setResult({ ok: false, text: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div>
        <Label>Server name</Label>
        <Input placeholder="Default" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label>WAHA base URL</Label>
        <Input placeholder="https://waha.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
      </div>
      <div>
        <Label>API key</Label>
        <Input
          type="password"
          placeholder="plain API key (not the sha512: hash)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
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
          <span className="selectable">{result.text}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={test} disabled={testing || !baseUrl || !apiKey}>
          {testing && <Loader2 size={14} className="animate-spin" />} Test connection
        </Button>
        <Button onClick={save} disabled={saving || !baseUrl || !apiKey || !dirty}>
          {saving && <Loader2 size={14} className="animate-spin" />} Save
        </Button>
        {settings.profiles.length > 0 && (
          <Button
            variant="ghost"
            className="ml-auto text-red-600"
            onClick={async () => {
              if (!(await confirm({ title: "Remove all servers and keys from this device?", danger: true, confirmLabel: "Confirm" })))
                return;
              await settings.clear();
              setBaseUrl("");
              setApiKey("");
              setResult(null);
              qc.clear();
            }}
          >
            Forget all
          </Button>
        )}
      </div>
    </>
  );
}
