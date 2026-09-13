import { useQuery } from "@tanstack/react-query";
import { X, Crown, Shield, Loader2, Users } from "lucide-react";
import { requireClient } from "@/store/settings";
import { Avatar, Badge } from "@/components/ui";
import { displayId, isGroup } from "@/lib/utils";
import type { ChatOverview } from "@/api/types";

/** Right-hand details panel for the open chat (group participants or contact info). */
export function InfoPanel({ session, chatId, chat, onClose }: { session: string; chatId: string; chat?: ChatOverview; onClose: () => void }) {
  const group = isGroup(chatId);
  const name = chat?.name || displayId(chatId);

  const groupQ = useQuery({
    queryKey: ["group", session, chatId],
    queryFn: () => requireClient().groupInfo(session, chatId),
    enabled: group,
    staleTime: 60_000,
  });
  const contactQ = useQuery({
    queryKey: ["contact", session, chatId],
    queryFn: () => requireClient().contactInfo(session, chatId),
    enabled: !group && chatId.endsWith("@c.us"),
    staleTime: 60_000,
  });

  return (
    <aside className="w-80 shrink-0 flex flex-col border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-neutral-200 dark:border-neutral-800">
        <span className="font-semibold flex-1">{group ? "Group info" : "Contact info"}</span>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-2 p-5 border-b border-neutral-100 dark:border-neutral-800">
          <Avatar src={chat?.picture} name={name} size={88} />
          <div className="font-semibold text-center selectable">{name}</div>
          <div className="text-xs text-neutral-500 selectable">{chatId}</div>
          {contactQ.data?.pushname && contactQ.data.pushname !== name && (
            <div className="text-xs text-neutral-500">~{contactQ.data.pushname}</div>
          )}
        </div>

        {group && (
          <>
            {groupQ.isLoading && <Loader2 className="animate-spin text-neutral-400 m-4" />}
            {groupQ.error && <div className="p-4 text-xs text-red-600 selectable">{(groupQ.error as Error).message}</div>}
            {groupQ.data && (
              <>
                {groupQ.data.Topic && (
                  <div className="p-4 border-b border-neutral-100 dark:border-neutral-800 text-sm whitespace-pre-wrap selectable">
                    {groupQ.data.Topic}
                  </div>
                )}
                <div className="px-4 py-2 flex items-center gap-2 text-xs text-neutral-500">
                  <Users size={12} /> {groupQ.data.Participants?.length ?? groupQ.data.ParticipantCount ?? 0} participants
                  {groupQ.data.IsAnnounce && <Badge tone="amber">admins only</Badge>}
                </div>
                <ul>
                  {[...(groupQ.data.Participants ?? [])]
                    .sort((a, b) => Number(b.IsSuperAdmin) - Number(a.IsSuperAdmin) || Number(b.IsAdmin) - Number(a.IsAdmin))
                    .map((p) => {
                      const phone = p.PhoneNumber?.replace(/@s\.whatsapp\.net$/, "");
                      const label = p.DisplayName || (phone ? `+${phone}` : displayId(p.JID));
                      return (
                        <li key={p.JID} className="flex items-center gap-2 px-4 py-1.5 text-sm">
                          <Avatar name={label} size={28} />
                          <span className="flex-1 truncate selectable">{label}</span>
                          {p.IsSuperAdmin ? (
                            <Crown size={14} className="text-amber-500" />
                          ) : p.IsAdmin ? (
                            <Shield size={14} className="text-emerald-600" />
                          ) : null}
                        </li>
                      );
                    })}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
