import { useSessions } from "@/api/queries";
import { cn } from "@/lib/utils";

/** Pick which WAHA session (business / number) something belongs to. Falls back to the given value if it is not on the server list. */
export function SessionSelect({ value, onChange, className, allowAll }: { value: string; onChange: (session: string) => void; className?: string; allowAll?: string }) {
  const { data: sessions } = useSessions();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-2 text-sm outline-none", className)}
      title="Session (business / number)"
    >
      {allowAll !== undefined && <option value="">{allowAll}</option>}
      {value && !sessions?.some((x) => x.name === value) && <option value={value}>{value}</option>}
      {sessions?.map((x) => (
        <option key={x.name} value={x.name}>{x.name}{x.me?.pushName ? ` · ${x.me.pushName}` : ""}</option>
      ))}
    </select>
  );
}
