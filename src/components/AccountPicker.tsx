import { useState } from "react";
import { Pencil } from "lucide-react";
import { useWhatsApp } from "@/store/whatsapp";

const NEW = "\u0000new";

/** Switch between linked WhatsApp accounts, link another, or rename the current one. */
export function AccountPicker() {
  const accounts = useWhatsApp((s) => s.accounts);
  const active = useWhatsApp((s) => s.active);
  const setActive = useWhatsApp((s) => s.setActive);
  const add = useWhatsApp((s) => s.add);
  const rename = useWhatsApp((s) => s.rename);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const current = accounts.find((a) => a.id === active) ?? accounts[0];

  const commit = () => {
    setRenaming(false);
    const next = name.trim();
    if (!current || !next || next === current.name) return;
    void rename(current.id, next).catch(console.error);
  };

  if (renaming && current) {
    return (
      <label className="flex items-center gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-sm">
        <span className="w-2 h-2 rounded-full shrink-0 bg-wa" />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setRenaming(false);
          }}
          placeholder="Account name"
          className="flex-1 min-w-0 bg-transparent outline-none"
        />
      </label>
    );
  }
  return (
    <label className="flex items-center gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1.5 text-sm">
      <span
        className={current?.status === "working" ? "w-2 h-2 rounded-full shrink-0 bg-wa" : "w-2 h-2 rounded-full shrink-0 bg-amber-400"}
      />
      <select
        value={current?.id ?? ""}
        onChange={(e) => {
          if (e.target.value === NEW) void add().catch(console.error);
          else setActive(e.target.value);
        }}
        className="flex-1 bg-transparent outline-none cursor-pointer min-w-0 truncate"
        title="Active account"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.me?.pushName ? ` · ${a.me.pushName}` : ""}
            {a.unread ? ` · ${a.unread} unread` : ""}
          </option>
        ))}
        <option value={NEW}>＋ Link a WhatsApp account…</option>
      </select>
      {current && (
        <button
          type="button"
          title="Rename this account"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setName(current.name);
            setRenaming(true);
          }}
          className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <Pencil size={13} />
        </button>
      )}
    </label>
  );
}
