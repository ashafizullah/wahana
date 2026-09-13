import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChats, useContacts, useSessions } from "@/api/queries";
import { requireClient, useSettings } from "@/store/settings";
import { isGroup } from "@/lib/utils";
import { usePushNames } from "@/store/pushNames";

export function useGroupInfo(session: string, chatId: string) {
  const client = useSettings((s) => s.client);
  return useQuery({
    queryKey: ["group", session, chatId],
    queryFn: () => requireClient().groupInfo(session, chatId),
    enabled: !!client && isGroup(chatId),
    staleTime: 5 * 60_000,
  });
}

/**
 * Name lookup for ids that appear in messages: mentions (`@123…`), LIDs,
 * phone ids. Sources: my own account, chat names, contacts, group participants.
 */
export function useNameResolver(session: string, chatId: string) {
  const { data: chats } = useChats(session);
  const { data: contacts } = useContacts(session);
  const { data: group } = useGroupInfo(session, chatId);
  const { data: sessions } = useSessions();
  const pushNames = usePushNames((s) => s.names);
  const me = sessions?.find((s) => s.name === session)?.me;

  const map = useMemo(() => {
    const m = new Map<string, string>();
    const put = (id: string | undefined | null, name: string | undefined | null) => {
      if (!id || !name) return;
      const digits = id.split("@")[0]!.split(":")[0]!;
      if (!m.has(digits)) m.set(digits, name);
    };
    if (me) {
      put(me.id, "You");
      put(me.lid, "You");
      put(me.jid, "You");
    }
    // Group participants: LID → display name or phone number
    for (const p of group?.Participants ?? []) {
      const phone = p.PhoneNumber?.split("@")[0];
      const name = p.DisplayName || (phone ? `+${phone}` : undefined);
      put(p.JID, name);
      put(p.LID, name);
      if (phone) put(phone, p.DisplayName || `+${phone}`);
    }
    for (const c of contacts ?? []) put(c.id, c.name || (c.pushname ? `~${c.pushname}` : undefined));
    for (const c of chats ?? []) put(c.id, c.name);
    return m;
  }, [me, group, contacts, chats]);

  // Second pass: if a LID maps to a phone number that itself has a contact name, prefer the name.
  const resolve = useCallback(
    (id: string): string | undefined => {
      const digits = id.split("@")[0]!.split(":")[0]!;
      const v = map.get(digits);
      // Real names win; otherwise a harvested push name ("~Name" like WhatsApp); otherwise the phone.
      const isReal = (x?: string) => !!x && !x.startsWith("+") && !x.startsWith("~");
      if (isReal(v)) return v;
      if (v?.startsWith("+")) {
        const byPhone = map.get(v.slice(1));
        if (isReal(byPhone)) return byPhone;
        const pn = pushNames[digits] ?? pushNames[v.slice(1)];
        if (pn) return `~${pn}`;
        return byPhone ?? v;
      }
      const pn = pushNames[digits];
      if (pn) return `~${pn}`;
      return v;
    },
    [map, pushNames],
  );
  return resolve;
}
