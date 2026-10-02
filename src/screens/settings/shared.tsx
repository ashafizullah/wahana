import { createContext, useContext, type ReactNode } from "react";
import { ChevronDown, Plug } from "lucide-react";
import { useAccounts } from "@/lib/account";

export const OpenCtx = createContext<{ open: string[]; toggle: (t: string) => void }>({ open: [], toggle: () => {} });

/** Which account the per-account settings sections edit; "" = the global default (every account). */
export const ScopeCtx = createContext<{ scope: string; setScope: (v: string) => void }>({ scope: "", setScope: () => {} });

/** "Apply to" selector for the per-account sections (Tweaks, Persona, Quick replies). */
export function AccountScopePicker() {
  const { scope, setScope } = useContext(ScopeCtx);
  const accounts = useAccounts();
  // Keep a since-removed account selectable so its stored overrides can still be seen/cleared.
  const known = accounts.some((a) => a.key === scope);
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-neutral-500">Apply to</span>
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none"
      >
        <option value="">All accounts (default)</option>
        {scope && !known && <option value={scope}>{scope}</option>}
        {accounts.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Plug;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { open, toggle } = useContext(OpenCtx);
  const expanded = open.includes(title);
  return (
    <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => toggle(title)}
        className={
          "w-full text-left px-5 py-3 flex items-start gap-3 " + (expanded ? "border-b border-neutral-100 dark:border-neutral-800" : "")
        }
      >
        <Icon size={16} className="text-wa-dark mt-0.5 shrink-0" />
        <span className="flex-1 min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {description && expanded && <p className="text-xs text-neutral-500 mt-1">{description}</p>}
        </span>
        <ChevronDown size={16} className={"shrink-0 text-neutral-400 transition-transform mt-0.5 " + (expanded ? "rotate-180" : "")} />
      </button>
      {expanded && <div className="px-5 py-4 space-y-4">{children}</div>}
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <span className="flex-1">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={"relative h-6 w-11 rounded-full transition " + (checked ? "bg-wa-dark" : "bg-neutral-300 dark:bg-neutral-700")}
      >
        <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition " + (checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}
