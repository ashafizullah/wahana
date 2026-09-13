import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChats, useContacts, useSessions } from "@/api/queries";
import { requireClient, useSettings } from "@/store/settings";
import { isGroup } from "@/lib/utils";
import { usePushNames } from "@/store/pushNames";

/** Full LID → phone table from the server, fetched once per session and kept in memory. */
export function useLidTable(session: string) {
  const client = useSettings((s) => s.client);
  return useQuery({
    queryKey: ["lids", session],
    queryFn: async () => {
      const c = requireClient();
      const map = new Map<string, string>();
      for (let offset = 0; ; offset += 5000) {
        const page = await c.lids(session, 5000, offset);
        for (const { lid, pn } of page) if (pn) map.set(lid.split("@")[0]!, pn.split("@")[0]!);
        if (page.length < 5000) break;
      }
      return map;
    },
    enabled: !!client && !!session,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

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
 * phone ids. Sources: my own account, chat names, contacts, group participants
 * (only when `chatId` is a group — omit it for a session-wide resolver, e.g. the chat list).
 */
export function useNameResolver(session: string, chatId = "") {
  const { data: chats } = useChats(session);
  const { data: contacts } = useContacts(session);
  const { data: group } = useGroupInfo(session, chatId); // no-op without a group chatId
  const { data: sessions } = useSessions();
  const pushNames = usePushNames((s) => s.names);
  const { data: lids } = useLidTable(session);
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
    (id: string | null | undefined): string | undefined => {
      if (!id) return undefined;
      const digits = id.split("@")[0]!.split(":")[0]!;
      const isReal = (x?: string) => !!x && !x.startsWith("+") && !x.startsWith("~");
      const v = map.get(digits);
      if (isReal(v)) return v;
      // Phone digits for this id: from the group/contacts map ("+62…") or the server LID table.
      const phone = v?.startsWith("+") ? v.slice(1) : lids?.get(digits);
      if (phone) {
        const byPhone = map.get(phone);
        if (isReal(byPhone)) return byPhone;
        const pn = pushNames[digits] ?? pushNames[phone];
        if (pn) return `~${pn}`;
        return `+${phone}`;
      }
      const pn = pushNames[digits];
      if (pn) return `~${pn}`;
      return v;
    },
    [map, pushNames, lids],
  );
  return resolve;
}
