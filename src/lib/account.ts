import { useWhatsApp } from "@/store/whatsapp";

/**
 * One linked WhatsApp account. `key` is the identity per-account settings, rules and
 * schedules are stored under: `native:<accountId>`.
 */
export interface AccountRef {
  key: string;
  label: string;
}

export const nativeAccountKey = (id: string) => `native:${id}`;

/** Key for a native chat, used by the shared per-chat prefs (pin, mute). */
export const nativeChatKey = (accountId: string, chatId: string) => `native:${accountId}:${chatId}`;

/** The native account id inside an account key, or null when the key is not a native account. */
export const accountId = (key: string): string | null => (key.startsWith("native:") ? key.slice("native:".length) : null);

/** Whether a stored scope applies to an account. `null` = every account. */
export function accountMatches(scope: string | null, account: string | null): boolean {
  if (!scope) return true;
  return scope === account;
}

/** Every linked account. */
export function useAccounts(): AccountRef[] {
  const native = useWhatsApp((s) => s.accounts);
  return native.map((a) => ({
    key: nativeAccountKey(a.id),
    label: a.me?.pushName ? `${a.name} · ${a.me.pushName}` : a.name,
  }));
}

/** A function that turns an account key into its label (falls back to the raw key). */
export function useAccountLabel(): (key: string) => string {
  const accounts = useAccounts();
  return (key) => accounts.find((a) => a.key === key)?.label ?? key;
}

/** The account the chat screen is showing: the picked one, else the first. */
export function useActiveAccount(): AccountRef | null {
  const accounts = useAccounts();
  const active = useWhatsApp((s) => s.active);
  return accounts.find((a) => a.key === nativeAccountKey(active ?? "")) ?? accounts[0] ?? null;
}

/** Account key for callbacks that run outside render (same precedence as `useActiveAccount`). */
export function activeAccountKey(): string | null {
  const wa = useWhatsApp.getState();
  const id = wa.accounts.find((a) => a.id === wa.active)?.id ?? wa.accounts[0]?.id;
  return id ? nativeAccountKey(id) : null;
}
