import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, MessageSquare, Copy, Check, Phone } from "lucide-react";
import { requireClient } from "@/store/settings";
import { Avatar, Button } from "@/components/ui";
import type { MentionResolver } from "@/lib/waMarkdown";
import { displayId } from "@/lib/utils";

/** Contact card for a participant id (LID or phone id): photo, names, number, open chat. */
export function ContactModal({
  session,
  id,
  resolveName,
  onOpenChat,
  onClose,
}: {
  session: string;
  id: string;
  resolveName: MentionResolver;
  onOpenChat?: (chatId: string) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pn = useQuery({
    queryKey: ["lid-pn", session, id],
    queryFn: () => requireClient().lidToPhone(session, id).then((r) => r.pn),
    enabled: id.endsWith("@lid"),
    staleTime: Infinity,
    retry: 0,
  });
  const phoneId = id.endsWith("@c.us") ? id : pn.data ?? null;
  const phone = phoneId?.split("@")[0] ?? "";
  const contact = useQuery({
    queryKey: ["contact", session, id],
    queryFn: () => requireClient().contactInfo(session, id),
    staleTime: 10 * 60_000,
    retry: 0,
  });
  const pic = useQuery({
    queryKey: ["profile-picture", session, id],
    queryFn: () => requireClient().profilePicture(session, id).then((r) => r.profilePictureURL),
    staleTime: 30 * 60_000,
    retry: 0,
  });

  const savedName = contact.data?.name || (phoneId ? resolveName(phoneId) : undefined) || resolveName(id);
  const realName = savedName && !savedName.startsWith("+") && !savedName.startsWith("~") ? savedName : undefined;
  const pushname = contact.data?.pushname || (savedName?.startsWith("~") ? savedName.slice(1) : undefined);
  const title = realName ?? (pushname ? `~${pushname}` : phone ? `+${phone}` : displayId(id));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[360px] rounded-xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden">
        <div className="flex justify-end p-2">
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="flex flex-col items-center gap-2 px-6 pb-5 -mt-2">
          <Avatar src={pic.data ?? undefined} name={title} size={96} />
          <div className="text-lg font-semibold text-center selectable">{title}</div>
          {realName && pushname && pushname !== realName && <div className="text-sm text-neutral-500 selectable">~{pushname}</div>}
          {phone ? (
            <button
              className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300 hover:text-wa-dark"
              title="Copy number"
              onClick={() => {
                void navigator.clipboard.writeText(`+${phone}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              <Phone size={14} /> <span className="selectable">+{phone}</span> {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} className="opacity-50" />}
            </button>
          ) : pn.isLoading ? (
            <div className="text-xs text-neutral-400">looking up number…</div>
          ) : (
            <div className="text-xs text-neutral-400 selectable">{id}</div>
          )}
          {contact.data?.isBusiness && <span className="text-[11px] rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5">Business account</span>}
        </div>
        {onOpenChat && (
          <div className="border-t border-neutral-100 dark:border-neutral-800 p-3">
            <Button className="w-full" disabled={!phoneId && !id} onClick={() => { onOpenChat(phoneId ?? id); onClose(); }}>
              <MessageSquare size={14} /> Message
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
