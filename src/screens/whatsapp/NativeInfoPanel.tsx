import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Crown,
  FileText,
  Globe,
  Image as ImageIcon,
  Images,
  Info,
  Link as LinkIcon,
  Loader2,
  Lock,
  Megaphone,
  MoreVertical,
  Play,
  Shield,
  Users,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Avatar, Input } from "@/components/ui";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { firstUrl } from "@/components/LinkPreview";
import { formatBytes } from "@/lib/mediaCache";
import {
  nativeWa,
  type NativeChatDetails,
  type NativeContactDetails,
  type NativeGroupDetails,
  type NativeGroupMember,
  type NativeMessage,
} from "@/lib/nativeWa";
import { cn, errMsg, formatTime } from "@/lib/utils";
import { WaMarkdown } from "@/lib/waMarkdown";
import { MuteControl } from "@/components/MuteControl";
import { nativeChatKey } from "@/lib/account";
import { useChatPrefs } from "@/store/chatPrefs";
import { NativeChannelRows } from "@/screens/whatsapp/NativeChannel";
import { MemberMenu, NativeGroupTools } from "@/screens/whatsapp/NativeGroupManage";
import { nativeMediaBlob, saveNativeMedia } from "@/screens/whatsapp/NativeMediaView";
import { usePicture } from "@/screens/whatsapp/usePicture";

/**
 * Right-hand details panel for a native WhatsApp chat, laid out like the WAHA one
 * (`components/InfoPanel`): the profile on top, a row into "Media, links and docs", the
 * group description and settings, and the participants in a searchable dialog. Details
 * are fetched live; names come from this account's contacts, with unsaved people shown by
 * number and their own "~name".
 */
export function NativeInfoPanel({
  accountId,
  chatId,
  connected,
  picture,
  onOpenChat,
  onClose,
}: {
  accountId: string;
  chatId: string;
  connected: boolean;
  /** The small picture already shown in the header, until the full one arrives. */
  picture: string | null;
  /** Open the direct chat with someone: candidate chat ids, best first. */
  onOpenChat: (ids: string[]) => void;
  onClose: () => void;
}) {
  const group = chatId.endsWith("@g.us");
  const channel = chatId.endsWith("@newsletter");
  const [view, setView] = useState<"info" | "media">("info");
  const [details, setDetails] = useState<NativeChatDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after a group change, to reload the details without blanking the panel. */
  const [reload, setReload] = useState(0);
  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    setDetails(null);
  }, [accountId, chatId]);

  useEffect(() => {
    setError(null);
    if (!connected) {
      setError("Connect the account to load details.");
      return;
    }
    let cancelled = false;
    nativeWa
      .chatInfo(accountId, chatId)
      .then((d) => !cancelled && setDetails(d))
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [accountId, chatId, connected, reload]);

  const muteKey = nativeChatKey(accountId, chatId);
  const muted = useChatPrefs((s) => s.muted[muteKey]);
  const setMuted = useChatPrefs((s) => s.setMuted);
  const amAdmin = details?.type === "group" && details.members.some((m) => m.isMe && m.admin);

  return (
    <aside className="w-80 shrink-0 flex flex-col border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-neutral-200 dark:border-neutral-800">
        <span className="font-semibold flex-1">
          {view === "media" ? "Media, links & docs" : group ? "Group info" : channel ? "Channel info" : "Contact info"}
        </span>
        <button onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {view === "media" ? (
        <NativeChatMedia accountId={accountId} chatId={chatId} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <Header chatId={chatId} details={details} picture={picture} />
          <button
            onClick={() => setView("media")}
            className="w-full flex items-center gap-3 px-5 py-3 text-sm border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <Images size={16} className="text-wa-dark" />
            <span className="flex-1 text-left">Media, links and docs</span>
            <ChevronRight size={16} className="text-neutral-400" />
          </button>
          {!channel && (
            <MuteControl
              until={muted}
              onSet={(until) => {
                setMuted(muteKey, until);
                void nativeWa.muteChat(accountId, chatId, until).catch(() => {});
              }}
              className="w-full flex items-center gap-3 px-5 py-3 text-sm border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
            />
          )}
          {!details && !error && <Loader2 className="animate-spin text-neutral-400 m-4" />}
          {error && <div className="p-4 text-xs text-red-600 selectable">{error}</div>}
          {details?.type === "contact" && <ContactRows details={details} />}
          {details?.type === "channel" && (
            <>
              {details.description && <Description text={details.description} />}
              <NativeChannelRows accountId={accountId} details={details} connected={connected} onLeft={onClose} onChanged={refresh} />
            </>
          )}
          {details?.type === "group" && (
            <>
              {details.description && <Description text={details.description} />}
              <GroupRows details={details} amAdmin={amAdmin} onOpenChat={onOpenChat} />
              <NativeGroupTools
                accountId={accountId}
                connected={connected}
                group={details}
                amAdmin={amAdmin}
                refresh={refresh}
                onLeft={onClose}
              />
              <ParticipantsRow
                accountId={accountId}
                connected={connected}
                group={details}
                amAdmin={amAdmin}
                refresh={refresh}
                onOpenChat={onOpenChat}
              />
            </>
          )}
        </div>
      )}
      {view === "media" && (
        <button
          onClick={() => setView("info")}
          className="shrink-0 flex items-center gap-1 px-4 py-2 text-xs text-neutral-500 border-t border-neutral-100 dark:border-neutral-800 hover:text-neutral-800"
        >
          <ChevronLeft size={14} /> Back to info
        </button>
      )}
    </aside>
  );
}

/** Profile block: picture (click for full size), name, and the number or chat id. */
function Header({ chatId, details, picture }: { chatId: string; details: NativeChatDetails | null; picture: string | null }) {
  const [open, setOpen] = useState(false);
  const full = details?.picture ?? null;
  let name = chatId.split("@")[0]!;
  let sub: string | null = chatId;
  let pushName: string | null = null;
  const phone = details?.type === "contact" ? details.phone : null;
  if (details?.type === "group") {
    name = details.subject;
    sub = `Group · ${details.members.length} participants`;
  } else if (details?.type === "channel") {
    name = details.name;
    sub = details.subscribers != null ? `Channel · ${details.subscribers.toLocaleString()} followers` : "Channel";
  } else if (details?.type === "contact") {
    if (details.saved && details.name) {
      name = details.name;
      sub = details.phone ?? chatId;
    } else {
      name = details.phone ?? details.name ?? name;
      sub = details.phone ? null : chatId;
      pushName = details.name && details.name !== details.phone ? details.name : null;
    }
  }
  return (
    <div className="flex flex-col items-center gap-2 p-5 border-b border-neutral-100 dark:border-neutral-800">
      <button onClick={() => full && setOpen(true)} disabled={!full} title={full ? "View photo" : undefined}>
        <Avatar src={full ?? picture} name={pushName ?? name} size={88} />
      </button>
      <div className="flex items-center gap-1.5 font-semibold text-center selectable">
        {name}
        {phone && name === phone && <CopyButton text={phone} />}
      </div>
      {sub && (
        <div className="flex items-center gap-1.5 text-xs text-neutral-500 selectable">
          {sub}
          {phone && sub === phone && <CopyButton text={phone} />}
        </div>
      )}
      {pushName && <div className="text-xs text-neutral-500">~{pushName}</div>}
      {open && full && <Lightbox item={{ blobUrl: full, kind: "image", filename: `${name}.jpg` }} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      title="Copy number"
      className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

/** Group description or About text, clamped to a few lines with a "Read more" toggle. */
function Description({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220 || text.split("\n").length > 4;
  return (
    <div className="p-4 border-b border-neutral-100 dark:border-neutral-800 text-sm">
      {label && <div className="text-[11px] text-neutral-500 mb-1">{label}</div>}
      <div className={"break-words selectable " + (open || !long ? "" : "line-clamp-4")}>
        <WaMarkdown text={text} />
      </div>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-1 text-xs font-medium text-wa-dark dark:text-wa hover:underline">
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function Row({ icon: Icon, children }: { icon: typeof Info; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <Icon size={15} className="text-wa-dark shrink-0" />
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

function ContactRows({ details: d }: { details: NativeContactDetails }) {
  if (!d.about && !d.business && d.saved) return null;
  return (
    <>
      {d.about && <Description text={d.about} label="About" />}
      {(d.business || d.verifiedName || !d.saved) && (
        <div className="py-1 border-b border-neutral-100 dark:border-neutral-800">
          {(d.business || d.verifiedName) && (
            <Row icon={BadgeCheck}>
              {d.verifiedName ?? "WhatsApp Business"}
              <span className="ml-1 text-xs text-neutral-500">· business account</span>
            </Row>
          )}
          {!d.saved && <Row icon={Info}>Not in your contacts</Row>}
        </div>
      )}
    </>
  );
}

const memberLabel = (m: NativeGroupMember) => (m.isMe ? "You" : m.saved && m.name ? m.name : (m.phone ?? m.name ?? m.id.split("@")[0]!));

/** A member's direct chat may run on their phone-number id or their privacy id. */
function chatIdsFor(m: NativeGroupMember) {
  const ids = [m.id];
  if (m.phone) ids.push(`${m.phone.replace(/\D/g, "")}@s.whatsapp.net`);
  return ids;
}

/** Who created the group and when; for non-admins also the settings, which admins toggle in the tools. */
function GroupRows({
  details: d,
  amAdmin,
  onOpenChat,
}: {
  details: NativeGroupDetails;
  amAdmin: boolean;
  onOpenChat: (ids: string[]) => void;
}) {
  const created = d.createdAt ? new Date(d.createdAt).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }) : null;
  const announce = d.announce && !amAdmin;
  const locked = d.locked && !amAdmin;
  if (!created && !d.creator && !announce && !locked) return null;
  return (
    <div className="py-1 border-b border-neutral-100 dark:border-neutral-800">
      {(created || d.creator) && (
        <Row icon={Info}>
          Created
          {d.creator && (
            <>
              {" by "}
              <button className="font-medium hover:underline" onClick={() => !d.creator!.isMe && onOpenChat(chatIdsFor(d.creator!))}>
                {memberLabel(d.creator)}
              </button>
            </>
          )}
          {created && <span className="text-neutral-500">, {created}</span>}
        </Row>
      )}
      {announce && <Row icon={Megaphone}>Only admins can send messages</Row>}
      {locked && <Row icon={Lock}>Only admins can edit group info</Row>}
    </div>
  );
}

// ── Participants ───────────────────────────────────────────────────────

/** Row showing the participant count; opens the searchable list. */
function ParticipantsRow(props: {
  accountId: string;
  connected: boolean;
  group: NativeGroupDetails;
  amAdmin: boolean;
  refresh: () => void;
  onOpenChat: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const n = props.group.members.length;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
      >
        <Users size={15} className="text-wa-dark" />
        <span className="flex-1">
          {n} participant{n === 1 ? "" : "s"}
          {props.group.announce && (
            <span className="ml-2 text-[10px] rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5">
              admins only
            </span>
          )}
        </span>
        <span className="text-xs text-neutral-400">›</span>
      </button>
      {open && <ParticipantsModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ParticipantsModal({
  accountId,
  connected,
  group,
  amAdmin,
  refresh,
  onOpenChat,
  onClose,
}: {
  accountId: string;
  connected: boolean;
  group: NativeGroupDetails;
  amAdmin: boolean;
  refresh: () => void;
  onOpenChat: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (menu ? setMenu(null) : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = () => setMenu(null);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const term = q.trim().toLowerCase().replace(/^\+/, "");
  const filtered = useMemo(() => {
    if (!term) return group.members;
    const digits = term.replace(/\D/g, "") || "\u0000";
    return group.members.filter(
      (m) => memberLabel(m).toLowerCase().includes(term) || (m.name ?? "").toLowerCase().includes(term) || (m.phone ?? "").includes(digits),
    );
  }, [group.members, term]);
  const admins = group.members.filter((m) => m.admin).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[460px] max-h-[80vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <Users size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1">
            Participants ({group.members.length})
            <span className="ml-2 text-xs font-normal text-neutral-500">
              {admins} admin{admins === 1 ? "" : "s"}
            </span>
          </span>
          <button onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-2 border-b border-neutral-100 dark:border-neutral-800">
          <Input placeholder="Search by name or phone number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {err && <div className="px-4 py-1 text-xs text-red-600 selectable">{err}</div>}
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 && <li className="p-6 text-sm text-neutral-500 text-center">No participants match.</li>}
          {filtered.map((m) => (
            <ParticipantRow
              key={m.id}
              accountId={accountId}
              connected={connected}
              member={m}
              onOpen={() => {
                onClose();
                onOpenChat(chatIdsFor(m));
              }}
              manage={
                amAdmin && !m.isMe && !m.superAdmin
                  ? {
                      open: menu === m.id,
                      toggle: () => setMenu(menu === m.id ? null : m.id),
                      menu: (
                        <MemberMenu
                          accountId={accountId}
                          groupId={group.id}
                          member={m}
                          label={memberLabel(m)}
                          refresh={refresh}
                          onError={setErr}
                          onClose={() => setMenu(null)}
                        />
                      ),
                    }
                  : null
              }
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ParticipantRow({
  accountId,
  connected,
  member: m,
  onOpen,
  manage,
}: {
  accountId: string;
  connected: boolean;
  member: NativeGroupMember;
  onOpen: () => void;
  /** Admin actions, when you may manage this member. */
  manage: { open: boolean; toggle: () => void; menu: React.ReactNode } | null;
}) {
  const picture = usePicture(accountId, m.id, connected);
  const label = memberLabel(m);
  const sub = m.isMe ? null : m.saved ? m.phone : m.name && m.name !== m.phone ? `~${m.name}` : null;
  return (
    <li className="relative flex items-center group">
      <button
        onClick={onOpen}
        disabled={m.isMe}
        title={m.isMe ? undefined : "Message"}
        className="flex-1 min-w-0 flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 disabled:hover:bg-transparent"
      >
        <Avatar src={picture} name={m.saved || m.isMe ? label : (m.name ?? label)} size={40} />
        <span className="flex-1 min-w-0">
          <span className="block truncate selectable font-medium">{label}</span>
          {sub && <span className="block text-xs text-neutral-500 selectable truncate">{sub}</span>}
        </span>
        {m.superAdmin ? <Crown size={14} className="text-amber-500" /> : m.admin ? <Shield size={14} className="text-emerald-600" /> : null}
        {manage && <span className="w-5 shrink-0" />}
      </button>
      {manage && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={manage.toggle}
          className="absolute right-3 p-1 opacity-0 group-hover:opacity-100 data-[open=true]:opacity-100 text-neutral-400 hover:text-neutral-700"
          data-open={manage.open}
          title="Manage"
        >
          <MoreVertical size={14} />
        </button>
      )}
      {manage?.open && manage.menu}
    </li>
  );
}

// ── Media, links and docs ──────────────────────────────────────────────

type Tab = "media" | "links" | "docs";

/** Stored messages scanned for links; attachments come from their own query. */
const LINK_SCAN = 2000;

function NativeChatMedia({ accountId, chatId }: { accountId: string; chatId: string }) {
  const [tab, setTab] = useState<Tab>("media");
  const [media, setMedia] = useState<NativeMessage[] | null>(null);
  const [texts, setTexts] = useState<NativeMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    nativeWa
      .chatMedia(accountId, chatId)
      .then((list) => !cancelled && setMedia([...list].reverse()))
      .catch((e) => !cancelled && setError(errMsg(e)));
    nativeWa
      .messages(accountId, chatId, LINK_SCAN)
      .then((list) => !cancelled && setTexts([...list].reverse()))
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [accountId, chatId]);

  const buckets = useMemo(() => {
    const visual = (media ?? []).filter((m) => m.media?.kind === "image" || m.media?.kind === "video");
    const docs = (media ?? []).filter((m) => m.media?.kind === "document");
    const links: { m: NativeMessage; url: string }[] = [];
    for (const m of texts ?? []) {
      const url = m.kind === "text" ? firstUrl(m.body) : null;
      if (url) links.push({ m, url });
    }
    return { visual, docs, links };
  }, [media, texts]);
  const loading = media === null || texts === null;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex gap-1 px-4 pt-3 pb-2">
        {(["media", "links", "docs"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              tab === t ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300",
            )}
          >
            {t === "media"
              ? `Media ${buckets.visual.length}`
              : t === "links"
                ? `Links ${buckets.links.length}`
                : `Docs ${buckets.docs.length}`}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {error && <p className="text-xs text-red-600 selectable py-2">{error}</p>}
        {tab === "media" && <MediaGrid accountId={accountId} items={buckets.visual} />}
        {tab === "links" && <LinkList items={buckets.links} />}
        {tab === "docs" && <DocList accountId={accountId} items={buckets.docs} />}
        <div className="pt-3 text-center">
          {loading ? (
            <Loader2 size={16} className="animate-spin text-neutral-400 inline" />
          ) : (
            <span className="text-[11px] text-neutral-400">From the {texts!.length} messages stored on this computer</span>
          )}
        </div>
      </div>
    </div>
  );
}

function MediaGrid({ accountId, items }: { accountId: string; items: NativeMessage[] }) {
  const [open, setOpen] = useState<LightboxItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const view = async (m: NativeMessage) => {
    setBusy(m.id);
    setError(null);
    try {
      const blob = await nativeMediaBlob(accountId, m);
      const mimetype = m.media!.mimetype;
      const kind = mimetype.startsWith("video/") ? "video" : "image";
      setOpen({
        blobUrl: URL.createObjectURL(blob),
        kind,
        filename: `${m.id}.${mimetype.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") ?? "bin"}`,
        caption: m.body || undefined,
      });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  if (!items.length) return <p className="text-xs text-neutral-500 py-4">No photos or videos yet.</p>;
  return (
    <>
      {error && <p className="text-xs text-red-600 selectable pb-2">{error}</p>}
      <div className="grid grid-cols-3 gap-1">
        {items.map((m) => (
          <button
            key={m.id}
            onClick={() => view(m)}
            className="relative aspect-square rounded-md overflow-hidden bg-neutral-200 dark:bg-neutral-800 grid place-items-center"
            title={formatTime(Math.floor(m.timestamp / 1000))}
          >
            {m.media!.thumbnail ? (
              <img src={m.media!.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <ImageIcon size={18} className="text-neutral-400" />
            )}
            {m.media!.kind === "video" && <Play size={18} className="relative text-white drop-shadow" />}
            {busy === m.id && <Loader2 size={18} className="relative text-white animate-spin" />}
          </button>
        ))}
      </div>
      {open && (
        <Lightbox
          item={open}
          onClose={() => {
            URL.revokeObjectURL(open.blobUrl);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function LinkList({ items }: { items: { m: NativeMessage; url: string }[] }) {
  if (!items.length) return <p className="text-xs text-neutral-500 py-4">No links yet.</p>;
  return (
    <ul className="space-y-1">
      {items.map(({ m, url }) => {
        let host = url;
        try {
          host = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          /* keep */
        }
        return (
          <li key={m.id}>
            <button
              onClick={() => openUrl(url)}
              className="w-full flex items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <div className="w-10 h-10 rounded bg-neutral-200 dark:bg-neutral-800 grid place-items-center shrink-0">
                <Globe size={16} className="text-neutral-400" />
              </div>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium truncate">{url}</span>
                <span className="block text-[11px] text-neutral-500 truncate">
                  <LinkIcon size={10} className="inline mr-1" />
                  {host} · {formatTime(Math.floor(m.timestamp / 1000))}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DocList({ accountId, items }: { accountId: string; items: NativeMessage[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async (m: NativeMessage) => {
    setBusy(m.id);
    setError(null);
    try {
      await saveNativeMedia(accountId, m);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };
  if (!items.length) return <p className="text-xs text-neutral-500 py-4">No documents yet.</p>;
  return (
    <>
      {error && <p className="text-xs text-red-600 selectable pb-2">{error}</p>}
      <ul className="space-y-1">
        {items.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => open(m)}
              title="Save file…"
              className="w-full flex items-center gap-2 rounded-lg p-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <div className="w-10 h-10 rounded bg-neutral-200 dark:bg-neutral-800 grid place-items-center shrink-0">
                {busy === m.id ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} className="text-neutral-500" />}
              </div>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium truncate">{m.media!.fileName ?? "file"}</span>
                <span className="block text-[11px] text-neutral-500 truncate">
                  {m.media!.size ? `${formatBytes(m.media!.size)} · ` : ""}
                  {formatTime(Math.floor(m.timestamp / 1000))}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
