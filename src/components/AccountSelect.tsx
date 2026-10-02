import { useAccounts } from "@/lib/account";
import { cn } from "@/lib/utils";

/** Pick which account (WAHA session or native number) something sends from. */
export function AccountSelect({
  value,
  onChange,
  className,
  allowAll,
}: {
  value: string;
  onChange: (account: string) => void;
  className?: string;
  allowAll?: string;
}) {
  const accounts = useAccounts();
  // Keep a since-removed account selectable so an existing job can still be seen/edited.
  const known = accounts.some((a) => a.key === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-2 text-sm outline-none",
        className,
      )}
      title="Account"
    >
      {allowAll !== undefined && <option value="">{allowAll}</option>}
      {value && !known && <option value={value}>{value}</option>}
      {accounts.map((a) => (
        <option key={a.key} value={a.key}>
          {a.label}
        </option>
      ))}
    </select>
  );
}
