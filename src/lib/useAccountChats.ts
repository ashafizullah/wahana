import { useEffect, useState } from "react";
import { accountId } from "@/lib/account";
import { nativeWa } from "@/lib/nativeWa";

export interface AccountChat {
  id: string;
  name: string;
  phone: string | null;
}

/** Chats of an account, for target/recipient pickers. */
export function useAccountChats(account: string | null): AccountChat[] {
  const [chats, setChats] = useState<AccountChat[]>([]);
  useEffect(() => {
    let cancelled = false;
    const id = account ? accountId(account) : null;
    if (!id) {
      setChats([]);
      return;
    }
    const load = async () => {
      try {
        const list = await nativeWa.chats(id);
        if (!cancelled) setChats(list.map((c) => ({ id: c.id, name: c.name, phone: c.phone })));
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
