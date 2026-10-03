import { useContext, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { AlertTriangle, FileText, Loader2, Pencil, Plus, RefreshCw, Search, Table, Trash2, X } from "lucide-react";
import { confirm } from "@/components/Confirm";
import { Badge, Button, Input, Label } from "@/components/ui";
import { cn, errMsg } from "@/lib/utils";
import { embedConfig, embedConfigIssue } from "@/lib/ai";
import { useAccountLabel } from "@/lib/account";
import { useSettings } from "@/store/settings";
import { deleteDoc, listDocs, listDocsFor, saveDoc, type KbDoc, type KbDocType } from "@/store/knowledge";
import {
  KB_MAX_DOC_CHARS,
  docChunkTexts,
  indexDoc,
  invalidateKbCache,
  kbConfigured,
  kbStats,
  reindexAll,
  retrieveKnowledge,
} from "@/lib/knowledge";
import { ScopeCtx, Toggle } from "./shared";

const rand = () => Math.random().toString(36).slice(2, 12);
const parse = <T,>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export function KnowledgeSection() {
  const { scope } = useContext(ScopeCtx);
  const qc = useQueryClient();
  const label = useAccountLabel();
  const { kbEnabled, kbTopK, kbMinScore, save } = useSettings();
  const [editing, setEditing] = useState<KbDoc | KbDocType | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testQ, setTestQ] = useState("");
  const [test, setTest] = useState<{ busy: boolean; hits?: { text: string; score: number }[]; error?: string }>({ busy: false });

  const docs = useQuery({
    queryKey: ["kb-docs", scope],
    queryFn: () => (scope === "" ? listDocs() : listDocsFor(scope)),
    refetchInterval: 15_000,
  });
  const stats = useQuery({ queryKey: ["kb-stats", scope], queryFn: () => kbStats(scope || undefined), refetchInterval: 15_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["kb-docs"] });
    qc.invalidateQueries({ queryKey: ["kb-stats"] });
  };
  const configured = kbConfigured();
  const configIssue = embedConfigIssue();
  const model = embedConfig().model;

  const index = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await indexDoc(id);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const list = docs.data ?? [];
  const newDoc = editing === "table" || editing === "text" ? null : editing;
  // Entries are per account unless "All accounts" is selected; the scope of the entry being edited
  // (or created) is shown in the editor so a global entry is never created by accident.
  const targetAccount = newDoc ? newDoc.account : scope || null;
  const scopeLabel = targetAccount ? label(targetAccount) : "All accounts";
  const chunks = stats.data?.chunks ?? 0;
  const stale = stats.data?.stale ?? 0;

  return (
    <>
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-5 py-4 space-y-4">
        <Toggle
          label="Use knowledge base in AI replies"
          hint="Retrieved facts are added to the auto-reply prompt. Off = knowledge is stored but never used."
          checked={kbEnabled}
          onChange={(v) => save({ kbEnabled: v })}
        />
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Chunks per reply</span>
            <NumberField min={1} max={20} value={kbTopK} onCommit={(n) => save({ kbTopK: Math.floor(n) })} className="w-20" />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Min similarity</span>
            <NumberField min={0} max={1} step={0.05} value={kbMinScore} onCommit={(n) => save({ kbMinScore: n })} className="w-24" />
          </label>
          <div className="text-xs text-neutral-500 ml-auto text-right">
            <div>{chunks} chunks indexed</div>
            {model && <div className="font-mono">{model}</div>}
          </div>
          <Button
            variant="secondary"
            disabled={!configured || busy !== null || list.length === 0}
            onClick={async () => {
              setBusy("all");
              setErr(null);
              try {
                const r = await reindexAll(scope || undefined);
                if (r.failed) setErr(`${r.failed} entr${r.failed > 1 ? "ies" : "y"} failed to index.`);
              } catch (e) {
                setErr(errMsg(e));
              } finally {
                setBusy(null);
                refresh();
              }
            }}
          >
            {busy === "all" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Re-index all
          </Button>
        </div>
        {!!stale && (
          <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <AlertTriangle size={12} /> {stale} entr{stale > 1 ? "ies" : "y"} not indexed yet or need re-indexing (new, restored, or
            embedding model changed).
          </div>
        )}
        {configIssue && (
          <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
            <AlertTriangle size={12} className="shrink-0" /> {configIssue}
          </div>
        )}
        {chunks > 0 && (
          <div className="border-t border-neutral-100 dark:border-neutral-800 pt-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Search size={12} className="text-neutral-400" />
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Test retrieval</span>
            </div>
            <div className="text-[11px] text-neutral-500">
              {scope
                ? "Searches this account's entries plus the global ones."
                : "Searches global entries only — pick an account above to test its full context."}
            </div>
            <div className="flex gap-2">
              <input
                value={testQ}
                onChange={(e) => setTestQ(e.target.value)}
                placeholder="Ask something a customer might ask…"
                className="flex-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-xs outline-none"
                onKeyDown={async (e) => {
                  if (e.key !== "Enter" || !testQ.trim() || test.busy || !configured) return;
                  setTest({ busy: true });
                  try {
                    const hits = await retrieveKnowledge(scope || null, testQ.trim(), { k: kbTopK, minScore: kbMinScore });
                    setTest({ busy: false, hits: hits.map((h) => ({ text: h.text, score: h.score })) });
                  } catch (e2) {
                    setTest({ busy: false, error: errMsg(e2) });
                  }
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={test.busy || !testQ.trim() || !configured}
                onClick={async () => {
                  setTest({ busy: true });
                  try {
                    const hits = await retrieveKnowledge(scope || null, testQ.trim(), { k: kbTopK, minScore: kbMinScore });
                    setTest({ busy: false, hits: hits.map((h) => ({ text: h.text, score: h.score })) });
                  } catch (e) {
                    setTest({ busy: false, error: errMsg(e) });
                  }
                }}
              >
                {test.busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Search
              </Button>
            </div>
            {test.error && <div className="text-xs text-red-600">{test.error}</div>}
            {test.hits && <div className="text-xs text-neutral-500">{test.hits.length} hits</div>}
            {test.hits?.map((h, i) => (
              <div key={i} className="flex gap-2 text-xs bg-neutral-50 dark:bg-neutral-800/60 rounded-lg px-2 py-1.5">
                <Badge tone={h.score > 0.5 ? "green" : "neutral"}>{h.score.toFixed(2)}</Badge>
                <span className="whitespace-pre-wrap selectable min-w-0">{h.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-3 py-2 text-sm">
          <AlertTriangle size={14} /> <span className="selectable">{err}</span>
        </div>
      )}

      <div className="space-y-2">
        {docs.isLoading && (
          <div className="text-sm text-neutral-500 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading entries…
          </div>
        )}
        {docs.error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-3 py-2 text-sm">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="selectable">Could not load knowledge entries: {errMsg(docs.error)}</span>
          </div>
        )}
        {list.map((d) => (
          <DocRow
            key={d.id}
            doc={d}
            model={model}
            label={label}
            busy={busy === d.id}
            onEdit={() => setEditing(d)}
            onIndex={() => index(d.id)}
            onDelete={async () => {
              if (
                await confirm({
                  title: `Delete “${d.title}”?`,
                  message: "Its vectors are removed too.",
                  danger: true,
                  confirmLabel: "Delete",
                })
              ) {
                await deleteDoc(d.id);
                invalidateKbCache();
                refresh();
              }
            }}
          />
        ))}
        {!docs.isLoading && !docs.error && list.length === 0 && (
          <div className="text-sm text-neutral-500">
            No knowledge entries yet. Entries are per account — check the "Apply to" selector above.
          </div>
        )}
      </div>

      {editing ? (
        <DocEditor
          key={newDoc?.id ?? (editing as string)}
          existing={newDoc}
          type={editing === "table" || editing === "text" ? editing : newDoc!.type}
          account={targetAccount}
          scopeLabel={scopeLabel}
          onCancel={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            refresh();
            if (configured) void index(id);
          }}
        />
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing("table")}>
            <Plus size={14} /> <Table size={14} /> Table
          </Button>
          <Button variant="secondary" onClick={() => setEditing("text")}>
            <Plus size={14} /> <FileText size={14} /> Text
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * A number input that keeps the typed text locally and saves only on blur/Enter, so clearing the
 * field or typing "0." mid-edit does not snap the value or write the store on every keystroke.
 */
function NumberField({
  value,
  min,
  max,
  step,
  onCommit,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (n: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)));
    setDraft(null);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={cn(
        "rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-sm outline-none",
        className,
      )}
    />
  );
}

function DocRow({
  doc,
  model,
  label,
  busy,
  onEdit,
  onIndex,
  onDelete,
}: {
  doc: KbDoc;
  model: string;
  label: (key: string) => string;
  busy: boolean;
  onEdit: () => void;
  onIndex: () => void;
  onDelete: () => void;
}) {
  const cols = parse<string[]>(doc.columns, []);
  const rows = parse<string[][]>(doc.rows, []);
  const stale = !!model && doc.embed_model !== model;
  const summary =
    doc.type === "table" ? `${cols.length} columns · ${rows.length} rows` : `${(doc.text ?? "").length.toLocaleString()} chars`;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3">
      <div className="w-9 h-9 rounded-full grid place-items-center shrink-0 bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
        {doc.type === "table" ? <Table size={16} /> : <FileText size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{doc.title}</span>
          <span
            className={cn(
              "shrink-0 text-[10px] rounded-full px-1.5 py-0.5",
              doc.account
                ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
                : "bg-neutral-100 dark:bg-neutral-800 text-neutral-500",
            )}
            title={doc.account ? "Only this account can use these facts" : "Every account can use these facts"}
          >
            {doc.account ? label(doc.account) : "all accounts"}
          </span>
          {busy ? (
            <Badge tone="blue">
              <Loader2 size={10} className="animate-spin" /> indexing
            </Badge>
          ) : doc.status === "error" ? (
            <Badge tone="red">error</Badge>
          ) : !doc.embed_model ? (
            <Badge tone="amber">not indexed</Badge>
          ) : stale ? (
            <Badge tone="amber">re-index needed</Badge>
          ) : (
            <Badge tone="green">{doc.chunk_count} chunks</Badge>
          )}
        </div>
        <div className="text-xs text-neutral-500 truncate">{summary}</div>
        {doc.status === "error" && doc.error && <div className="text-[11px] text-red-600 truncate selectable">{doc.error}</div>}
      </div>
      <Button size="sm" variant="ghost" title="Re-index" disabled={busy} onClick={onIndex}>
        <RefreshCw size={14} />
      </Button>
      <Button size="sm" variant="ghost" title="Edit" disabled={busy} onClick={onEdit}>
        <Pencil size={14} />
      </Button>
      <Button size="sm" variant="ghost" className="text-red-600" title="Delete" disabled={busy} onClick={onDelete}>
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

function DocEditor({
  existing,
  type,
  account,
  scopeLabel,
  onSaved,
  onCancel,
}: {
  existing: KbDoc | null;
  type: KbDocType;
  account: string | null;
  scopeLabel: string;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [id] = useState(existing?.id ?? rand());
  const [title, setTitle] = useState(existing?.title ?? "");
  const [columns, setColumns] = useState<string[]>(() => parse<string[]>(existing?.columns ?? null, ["", ""]));
  const [rows, setRows] = useState<string[][]>(() => parse<string[][]>(existing?.rows ?? null, [["", ""]]));
  const [text, setText] = useState(existing?.text ?? "");
  const [tsv, setTsv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setCol = (i: number, v: string) => setColumns((c) => c.map((x, j) => (j === i ? v : x)));
  const addCol = () => {
    setColumns((c) => [...c, ""]);
    setRows((r) => r.map((row) => [...row, ""]));
  };
  const delCol = (i: number) => {
    setColumns((c) => c.filter((_, j) => j !== i));
    setRows((r) => r.map((row) => row.filter((_, j) => j !== i)));
  };
  const setCell = (ri: number, ci: number, v: string) =>
    setRows((r) => r.map((row, j) => (j === ri ? row.map((x, k) => (k === ci ? v : x)) : row)));
  const addRow = () => setRows((r) => [...r, columns.map(() => "")]);
  const delRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const preview = useMemo(
    () => docChunkTexts({ type, title, columns: JSON.stringify(columns), rows: JSON.stringify(rows), text }).length,
    [type, title, columns, rows, text],
  );

  const valid =
    title.trim() &&
    (type === "table"
      ? columns.some((c) => c.trim()) && rows.some((r) => r.some((c) => c.trim()))
      : text.trim() && text.length <= KB_MAX_DOC_CHARS);

  const applyTsv = () => {
    const lines = (tsv ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const grid = lines.map((l) => l.split("\t").map((c) => c.trim()));
    if (!grid.length) return setTsv(null);
    const heading = columns.some((c) => c.trim());
    if (!heading) {
      setColumns(grid[0]!);
      setRows(grid.slice(1));
    } else {
      // Columns already named: drop a pasted header row rather than importing it as data.
      const first = grid[0]!;
      const isHeader =
        first.length === columns.length && first.every((c, i) => c.trim().toLowerCase() === columns[i]!.trim().toLowerCase());
      setRows((r) => [...r.filter((row) => row.some((c) => c.trim())), ...grid.slice(isHeader ? 1 : 0)]);
    }
    setTsv(null);
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await saveDoc({
        id,
        account,
        type,
        title: title.trim(),
        columns: type === "table" ? JSON.stringify(columns) : null,
        rows: type === "table" ? JSON.stringify(rows) : null,
        text: type === "text" ? text.trim() : null,
      });
      onSaved(id);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-4 space-y-3">
      <div className="flex items-center gap-2">
        {type === "table" ? <Table size={16} className="text-wa-dark" /> : <FileText size={16} className="text-wa-dark" />}
        <span className="font-semibold flex-1">
          {existing ? "Edit" : "New"} {type === "table" ? "table" : "text"}
        </span>
        <span className="text-[11px] text-neutral-500">
          ≈ {preview} chunk{preview === 1 ? "" : "s"}
        </span>
        <button className="text-neutral-400 hover:text-neutral-700" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>

      <div>
        <Label>Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Daftar produk · Kebijakan pengiriman" autoFocus />
      </div>

      <div className="flex items-center gap-2 text-[11px] text-neutral-500">
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5",
            account ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" : "bg-neutral-100 dark:bg-neutral-800",
          )}
        >
          {scopeLabel}
        </span>
        <span>
          {account
            ? "Only this account's AI replies can use this entry."
            : 'Every account\'s AI replies can use this entry. Pick an account in "Apply to" above to limit it.'}
        </span>
      </div>

      {type === "table" ? (
        <>
          <div>
            <Label>Columns</Label>
            <div className="flex flex-wrap gap-2">
              {columns.map((c, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input value={c} onChange={(e) => setCol(i, e.target.value)} placeholder={`Kolom ${i + 1}`} className="w-32" />
                  <button
                    className={cn(
                      "text-neutral-400 hover:text-red-600",
                      rows.some((r) => r[i]?.trim()) && "opacity-30 pointer-events-none",
                    )}
                    onClick={() => delCol(i)}
                    title={rows.some((r) => r[i]?.trim()) ? "Clear the column's cells before removing it" : "Remove column"}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={addCol}>
                <Plus size={12} /> Column
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th key={i} className="px-1 py-1 text-left text-[11px] font-medium text-neutral-500">
                      {c.trim() || `Kolom ${i + 1}`}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {columns.map((_, ci) => (
                      <td key={ci} className="px-1 py-0.5">
                        <input
                          value={row[ci] ?? ""}
                          onChange={(e) => setCell(ri, ci, e.target.value)}
                          className="w-32 rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-1 text-xs outline-none"
                        />
                      </td>
                    ))}
                    <td>
                      <button className="text-neutral-400 hover:text-red-600" onClick={() => delRow(ri)} title="Remove row">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={addRow}>
              <Plus size={12} /> Row
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTsv(tsv === null ? "" : null)}>
              Paste from spreadsheet
            </Button>
          </div>
          {tsv !== null && (
            <div className="space-y-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2">
              <textarea
                value={tsv}
                onChange={(e) => setTsv(e.target.value)}
                rows={4}
                placeholder={"Produk\tHarga\tStok\nTote bag\t150k\tReady"}
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 font-mono text-xs outline-none"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!tsv.trim()} onClick={applyTsv}>
                  Apply
                </Button>
                <span className="text-[11px] text-neutral-500">Tab-separated. First line becomes the header when columns are unnamed.</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div>
            <Label>Text</Label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="Kebijakan pengiriman, FAQ, syarat retur…"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-wa-dark resize-y"
            />
            <div className="flex items-center gap-2 mt-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const p = await open({ multiple: false, filters: [{ name: "Text", extensions: ["txt", "md"] }] });
                  if (!p || typeof p !== "string") return;
                  try {
                    setText(await readTextFile(p));
                  } catch (e) {
                    setErr(errMsg(e));
                  }
                }}
              >
                <FileText size={12} /> Import .txt / .md
              </Button>
              <span className={cn("text-[11px]", text.length > KB_MAX_DOC_CHARS ? "text-red-600" : "text-neutral-500")}>
                {text.length.toLocaleString()} / {KB_MAX_DOC_CHARS.toLocaleString()} chars
              </span>
            </div>
          </div>
        </>
      )}

      {err && <div className="text-sm text-red-600 selectable">{err}</div>}
      <div className="flex gap-2">
        <Button disabled={!valid || busy} onClick={save}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Save {existing ? "& re-index" : "& index"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
