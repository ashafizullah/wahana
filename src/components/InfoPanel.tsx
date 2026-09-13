import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Loader2, Users, Images, ChevronRight, ChevronLeft } from "lucide-react";
import { requireClient } from "@/store/settings";
import { Avatar, Badge } from "@/components/ui";
import { displayId, isGroup } from "@/lib/utils";
import type { ChatOverview } from "@/api/types";
import { WaMarkdown, type MentionResolver } from "@/lib/waMarkdown";
import { useNameResolver } from "@/realtime/useNames";
import { ChatMedia } from "@/components/ChatMedia";
import { GroupTools, ParticipantList } from "@/components/GroupManage";

/** Right-hand details panel for the open chat (group participants or contact info). */
export function InfoPanel({
  session,
  chatId,
  chat,
  myIds,
  onClose,
}: {
  session: string;
  chatId: string;
  chat?: ChatOverview;
  myIds: string[];
  onClose: () => void;
}) {
  const group = isGroup(chatId);
  const name = chat?.name || displayId(chatId);
  const resolveName: MentionResolver = useNameResolver(session, chatId);
  const [view, setView] = useState<"info" | "media">("info");

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
        <span className="font-semibold flex-1">{view === "media" ? "Media, links & docs" : group ? "Group info" : "Contact info"}</span>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      {view === "media" ? (
        <ChatMedia session={session} chatId={chatId} />
      ) : (
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-2 p-5 border-b border-neutral-100 dark:border-neutral-800">
          <Avatar src={chat?.picture} name={name} size={88} />
          <div className="font-semibold text-center selectable">{name}</div>
          <div className="text-xs text-neutral-500 selectable">{chatId}</div>
          {contactQ.data?.pushname && contactQ.data.pushname !== name && (
            <div className="text-xs text-neutral-500">~{contactQ.data.pushname}</div>
          )}
        </div>
        <button
          onClick={() => setView("media")}
          className="w-full flex items-center gap-3 px-5 py-3 text-sm border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
        >
          <Images size={16} className="text-wa-dark" />
          <span className="flex-1 text-left">Media, links and docs</span>
          <ChevronRight size={16} className="text-neutral-400" />
        </button>

        {group && (
          <>
            {groupQ.isLoading && <Loader2 className="animate-spin text-neutral-400 m-4" />}
            {groupQ.error && <div className="p-4 text-xs text-red-600 selectable">{(groupQ.error as Error).message}</div>}
            {groupQ.data && (
              <>
                {groupQ.data.Topic && (
                  <div className="p-4 border-b border-neutral-100 dark:border-neutral-800 text-sm break-words selectable">
                    <WaMarkdown text={groupQ.data.Topic} mentions={resolveName} />
                  </div>
                )}
                <GroupTools session={session} chatId={chatId} group={groupQ.data} myIds={myIds} onLeft={onClose} />
                <div className="px-4 py-2 flex items-center gap-2 text-xs text-neutral-500">
                  <Users size={12} /> {groupQ.data.Participants?.length ?? groupQ.data.ParticipantCount ?? 0} participants
                  {groupQ.data.IsAnnounce && <Badge tone="amber">admins only</Badge>}
                </div>
                <ParticipantList session={session} chatId={chatId} group={groupQ.data} myIds={myIds} resolveName={resolveName} />
              </>
            )}
          </>
        )}
      </div>
      )}
      {view === "media" && (
        <button onClick={() => setView("info")} className="shrink-0 flex items-center gap-1 px-4 py-2 text-xs text-neutral-500 border-t border-neutral-100 dark:border-neutral-800 hover:text-neutral-800">
          <ChevronLeft size={14} /> Back to info
        </button>
      )}
    </aside>
  );
}
