import { useEffect, useState } from "react";
import { accountParts } from "@/lib/account";
import { nativeWa } from "@/lib/nativeWa";
import { requireClient } from "@/store/settings";

export interface AccountChat {
  id: string;
  name: string;
  phone: string | null;
}

/** Chats of an account, for target/recipient pickers: the WAHA overview or the native chat list. */
export function useAccountChats(account: string | null): AccountChat[] {
  const [chats, setChats] = useState<AccountChat[]>([]);
  useEffect(() => {
    let cancelled = false;
    const p = account ? accountParts(account) : null;
    if (!p) {
      setChats([]);
      return;
    }
    const load = async () => {
      try {
        if (p.kind === "native" && p.id) {
          const list = await nativeWa.chats(p.id);
          if (!cancelled) setChats(list.map((c) => ({ id: c.id, name: c.name, phone: c.phone })));
        } else if (p.kind === "waha" && p.session !== undefined) {
          const c = requireClient();
          const [overview, contacts] = await Promise.all([c.chatsOverview(p.session, 200), c.contacts(p.session).catch(() => [])]);
          const merged = new Map<string, AccountChat>();
          for (const x of overview) merged.set(x.id, { id: x.id, name: x.name ?? x.id, phone: null });
          for (const contact of contacts) {
            if (!contact.id.endsWith("@c.us") || merged.has(contact.id)) continue;
            merged.set(contact.id, { id: contact.id, name: contact.name || contact.pushname || contact.id, phone: null });
          }
          if (!cancelled) setChats([...merged.values()]);
        }
      } catch {
        if (!cancelled) setChats([]);
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [account]);
  return chats;
}
