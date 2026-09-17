import { useEffect, useState } from "react";
import { confirm } from "@/components/Confirm";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { cacheClear, cacheStats, formatBytes, type CacheStats } from "@/lib/mediaCache";
import { useSettings } from "@/store/settings";
import { Button, Input } from "@/components/ui";

export function StorageSection() {
  const limit = useSettings((s) => s.cacheLimitMb);
  const save = useSettings((s) => s.save);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [limitText, setLimitText] = useState(String(limit));

  const refresh = async () => {
    try {
      setStats(await cacheStats());
    } catch (e) {
      console.warn(e);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => setLimitText(String(limit)), [limit]);

  return (
    <>
      <div className="flex items-center gap-3 text-sm">
        <span className="flex-1 min-w-0">
          <span className="block font-medium">
            {stats ? `${formatBytes(stats.bytes)} · ${stats.files} file${stats.files === 1 ? "" : "s"}` : "—"}
          </span>
          {stats && (
            <span className="block text-xs text-neutral-500 selectable truncate" title={stats.path}>
              {stats.path}
            </span>
          )}
        </span>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={refresh} title="Refresh">
          <RefreshCw size={14} />
        </Button>
        <Button
          size="sm"
          variant="danger"
          className="shrink-0"
          disabled={busy || !stats?.files}
          onClick={async () => {
            if (
              !(await confirm({
                title: "Delete all cached media? They will be downloaded again when viewed.",
                danger: true,
                confirmLabel: "Confirm",
              }))
            )
              return;
            setBusy(true);
            try {
              await cacheClear();
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Clear cache
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex-1">
          <span className="block text-sm">Cache limit</span>
          <span className="block text-xs text-neutral-500">Megabytes; 0 means unlimited.</span>
        </span>
        <Input
          className="w-28 text-right"
          type="number"
          min={0}
          value={limitText}
          onChange={(e) => setLimitText(e.target.value)}
          onBlur={() => {
            const n = Math.max(0, Math.round(Number(limitText) || 0));
            if (n !== limit) void save({ cacheLimitMb: n });
          }}
        />
        <span className="text-sm text-neutral-500">MB</span>
      </div>
    </>
  );
}
