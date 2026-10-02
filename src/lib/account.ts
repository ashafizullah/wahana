import { useSessions } from "@/api/queries";
import { useSettings } from "@/store/settings";
import { useWhatsApp } from "@/store/whatsapp";

/**
 * One WhatsApp number the app is connected to, WAHA or native. `key` is the identity
 * per-account settings are stored under: `waha:<profileId>:<session>` or `native:<accountId>`.
 */
export interface AccountRef {
  key: string;
  kind: "waha" | "native";
  label: string;
}

export const wahaAccountKey = (profile: string, session: string) => `waha:${profile}:${session}`;
export const nativeAccountKey = (id: string) => `native:${id}`;

/** Key for a native chat, used by the shared per-chat prefs (pin, mute). */
export const nativeChatKey = (accountId: string, chatId: string) => `native:${accountId}:${chatId}`;

export interface AccountParts {
  kind: "waha" | "native";
  profile?: string;
  session?: string;
  id?: string;
}

/** Splits an account key back into its parts, or null when it is not in the known shape. */
export function accountParts(key: string): AccountParts | null {
  if (key.startsWith("native:")) return { kind: "native", id: key.slice("native:".length) };
  if (key.startsWith("waha:")) {
    const [profile, ...session] = key.slice("waha:".length).split(":");
    return { kind: "waha", profile, session: session.join(":") };
  }
  return null;
}

/**
 * Whether a stored scope applies to an account. `null` = every account; `waha:<profile>:*` =
 * every session of one server (the shape legacy "all sessions" quick replies migrated to).
 */
export function accountMatches(scope: string | null, account: string | null): boolean {
  if (!scope) return true;
  if (!account) return false;
  if (scope === account) return true;
  return scope.endsWith(":*") && account.startsWith(scope.slice(0, -1));
}

/** Every account the settings screen can scope to: WAHA sessions of the active profile + native accounts. */
export function useAccounts(): AccountRef[] {
  const { data: sessions } = useSessions();
  const profile = useSettings((s) => s.activeProfile);
  const native = useWhatsApp((s) => s.accounts);
  return [
    ...(sessions ?? []).map((s) => ({
      key: wahaAccountKey(profile, s.name),
      kind: "waha" as const,
      label: s.me?.pushName ? `${s.name} · ${s.me.pushName}` : s.name,
    })),
    ...native.map((a) => ({
      key: nativeAccountKey(a.id),
      kind: "native" as const,
      label: a.me?.pushName ? `${a.name} · ${a.me.pushName}` : a.name,
    })),
  ];
}

/** A function that turns an account key into its label (falls back to the raw key). */
export function useAccountLabel(): (key: string) => string {
  const accounts = useAccounts();
  const profiles = useSettings((s) => s.profiles);
  return (key) => {
    const known = accounts.find((a) => a.key === key)?.label;
    if (known) return known;
    // A session of another WAHA server: name the server instead of showing its id.
    const p = accountParts(key);
    const server = p?.kind === "waha" ? profiles.find((x) => x.id === p.profile)?.name : undefined;
    return server ? `${p!.session} · ${server}` : key;
  };
}

/** The account the chat screen is showing: a native account if one is picked, else the WAHA session. */
export function useActiveAccount(): AccountRef | null {
  const { data: sessions } = useSessions();
  const profile = useSettings((s) => s.activeProfile);
  const session = useSettings((s) => s.session);
  const native = useWhatsApp((s) => s.accounts);
  const active = useWhatsApp((s) => s.active);
  if (active) {
    const a = native.find((x) => x.id === active);
    const name = a?.name ?? "WhatsApp";
    return { key: nativeAccountKey(active), kind: "native", label: a?.me?.pushName ? `${name} · ${a.me.pushName}` : name };
  }
  if (!profile) return null;
  const cur = sessions?.find((s) => s.name === session);
  return { key: wahaAccountKey(profile, session), kind: "waha", label: cur?.me?.pushName ? `${session} · ${cur.me.pushName}` : session };
}

/** Account key for callbacks that run outside render (same precedence as `useActiveAccount`). */
export function activeAccountKey(): string | null {
  const wa = useWhatsApp.getState();
  if (wa.active) return nativeAccountKey(wa.active);
  const s = useSettings.getState();
  return s.activeProfile ? wahaAccountKey(s.activeProfile, s.session) : null;
}
