import { useState } from "react";
import { confirm } from "@/components/Confirm";
import { CheckCircle2, Download, Loader2, Upload, XCircle } from "lucide-react";
import { exportBackup, pickBackup, restoreBackup, type Backup, type RestoreOptions } from "@/lib/backup";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui";
import { errMsg } from "@/lib/utils";

export function BackupSection() {
  const qc = useQueryClient();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<{ path: string; backup: Backup } | null>(null);
  const [opts, setOpts] = useState<RestoreOptions>({ prefs: true, profiles: true, chatPrefs: true, quickReplies: true, schedules: true });

  return (
    <>
      <div className="space-y-2">
        <div className="text-sm font-medium">Export</div>
        <p className="text-xs text-neutral-500">
          Includes: preferences, servers, AI settings, pinned/muted/archived chats, quick replies, schedules (without attachments). Not
          included: message history, media cache, receipts.
        </p>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="mt-1" checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)} />
          <span>
            Include API keys (WAHA + AI)
            <span className="block text-xs text-amber-700 dark:text-amber-300">
              Keys are written in plain text — keep the file private.
            </span>
          </span>
        </label>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={async () => {
            if (
              includeSecrets &&
              !(await confirm({
                title: "Export API keys in plain text?",
                message: "Anyone with the file can use your WAHA server and AI account.",
                danger: true,
                confirmLabel: "Export anyway",
              }))
            )
              return;
            setBusy("export");
            setMsg(null);
            try {
              const p = await exportBackup(includeSecrets);
              if (p) setMsg({ ok: true, text: `Saved to ${p}` });
            } catch (e) {
              setMsg({ ok: false, text: errMsg(e) });
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "export" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export backup…
        </Button>
      </div>

      <div className="space-y-2 border-t border-neutral-100 dark:border-neutral-800 pt-3">
        <div className="text-sm font-medium">Restore</div>
        {!pending ? (
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={async () => {
              setMsg(null);
              try {
                const r = await pickBackup();
                if (r) setPending(r);
              } catch (e) {
                setMsg({ ok: false, text: errMsg(e) });
              }
            }}
          >
            <Upload size={14} /> Choose backup file…
          </Button>
        ) : (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-2">
            <div className="text-xs text-neutral-500 selectable truncate">{pending.path}</div>
            <div className="text-xs text-neutral-500">
              Exported {new Date(pending.backup.exportedAt).toLocaleString()} · app {pending.backup.appVersion} ·{" "}
              {pending.backup.profiles?.length ?? 0} server(s) · {pending.backup.quickReplies?.length ?? 0} quick replies ·{" "}
              {pending.backup.schedules?.length ?? 0} schedules{pending.backup.secrets ? " · includes API keys" : ""}
            </div>
            <div className="grid grid-cols-2 gap-1 text-sm">
              {(
                [
                  ["prefs", "Preferences & AI settings"],
                  ["profiles", "Servers (merged by id)"],
                  ["chatPrefs", "Pinned / muted / archived"],
                  ["quickReplies", "Quick replies"],
                  ["schedules", "Schedules"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {label}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                disabled={busy !== null}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: "Restore this backup?",
                      message:
                        "Selected sections are merged into the current configuration. Existing items with the same id are overwritten.",
                      confirmLabel: "Restore",
                    }))
                  )
                    return;
                  setBusy("import");
                  try {
                    await restoreBackup(pending.backup, opts);
                    qc.clear();
                    setPending(null);
                    setMsg({ ok: true, text: "Restored. Some changes apply after the app is reopened." });
                  } catch (e) {
                    setMsg({ ok: false, text: errMsg(e) });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === "import" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Restore
              </Button>
              <Button variant="secondary" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
      {msg && (
        <div
          className={
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm " +
            (msg.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300")
          }
        >
          {msg.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span className="selectable break-all">{msg.text}</span>
        </div>
      )}
    </>
  );
}
