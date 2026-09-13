import { useEffect, useRef, useState } from "react";
import { confirm } from "@/components/Confirm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Shield, MoreVertical, UserPlus, Link as LinkIcon, RefreshCw, LogOut, Pencil, Loader2, Copy, Check, UserCheck, X as XIcon, Users } from "lucide-react";
import { requireClient } from "@/store/settings";
import { Avatar, Button, Input } from "@/components/ui";
import { cn, displayId } from "@/lib/utils";
import type { GowsGroup, JoinRequest } from "@/api/types";
import type { MentionResolver } from "@/lib/waMarkdown";
import { qk } from "@/api/queries";

type P = NonNullable<GowsGroup["Participants"]>[number];

/** Id WAHA accepts for participant operations: phone form when known, else the JID. */
const pid = (p: P) => (p.PhoneNumber ? `${p.PhoneNumber.split("@")[0]}@c.us` : p.JID);
const digits = (id: string | undefined | null) => id?.split("@")[0]?.split(":")[0] ?? "";

export function useAmAdmin(group: GowsGroup | undefined, myIds: string[]) {
  const mine = new Set(myIds.map(digits));
  const me = group?.Participants?.find((p) => mine.has(digits(p.JID)) || mine.has(digits(p.LID)) || mine.has(digits(p.PhoneNumber)));
  return { amAdmin: !!(me?.IsAdmin || me?.IsSuperAdmin), amSuperAdmin: !!me?.IsSuperAdmin, meP: me };
}

/** Row in the info panel showing the participant count; opens the searchable modal. */
export function ParticipantsRow(props: { session: string; chatId: string; group: GowsGroup; myIds: string[]; resolveName: MentionResolver }) {
  const [open, setOpen] = useState(false);
  const n = props.group.Participants?.length ?? props.group.ParticipantCount ?? 0;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
      >
        <Users size={15} className="text-wa-dark" />
        <span className="flex-1">
          {n} participant{n === 1 ? "" : "s"}
          {props.group.IsAnnounce && <span className="ml-2 text-[10px] rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5">admins only</span>}
        </span>
        <span className="text-xs text-neutral-400">›</span>
      </button>
      {open && <ParticipantsModal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Searchable participant list with admin actions (remove / promote / demote). */
function ParticipantsModal({
  session,
  chatId,
  group,
  myIds,
  resolveName,
  onClose,
}: {
  session: string;
  chatId: string;
  group: GowsGroup;
  myIds: string[];
  resolveName: MentionResolver;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { amAdmin, meP } = useAmAdmin(group, myIds);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (menu ? setMenu(null) : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(null);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const act = async (label: string, p: P, fn: () => Promise<unknown>) => {
    setMenu(null);
    setErr(null);
    setBusy(p.JID);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["group", session, chatId] });
    } catch (e) {
      setErr(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const rows = [...(group.Participants ?? [])]
    .map((p) => {
      const phone = p.PhoneNumber?.split("@")[0] ?? "";
      const isMe = p.JID === meP?.JID;
      const label = isMe ? "You" : resolveName(p.JID) ?? p.DisplayName ?? (phone ? `+${phone}` : displayId(p.JID));
      return { p, phone, isMe, label };
    })
    .sort((a, b) => Number(b.p.IsSuperAdmin) - Number(a.p.IsSuperAdmin) || Number(b.p.IsAdmin) - Number(a.p.IsAdmin) || a.label.localeCompare(b.label));
  const term = q.trim().toLowerCase().replace(/^\+/, "");
  const filtered = term
    ? rows.filter(({ label, phone, p }) => label.toLowerCase().includes(term) || phone.includes(term.replace(/\D/g, "") || "\u0000") || digits(p.JID).includes(term))
    : rows;
  const admins = rows.filter((r) => r.p.IsAdmin || r.p.IsSuperAdmin).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div ref={ref} className="w-[460px] max-h-[80vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
      <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
        <Users size={16} className="text-wa-dark" />
        <span className="font-semibold flex-1">
          Participants ({rows.length})
          <span className="ml-2 text-xs font-normal text-neutral-500">{admins} admin{admins === 1 ? "" : "s"}</span>
        </span>
        <button onClick={onClose}><XIcon size={16} /></button>
      </div>
      <div className="p-2 border-b border-neutral-100 dark:border-neutral-800">
        <Input placeholder="Search by name or phone number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {err && <div className="px-4 py-1 text-xs text-red-600 selectable">{err}</div>}
      <ul className="flex-1 overflow-y-auto">
        {filtered.length === 0 && <li className="p-6 text-sm text-neutral-500 text-center">No participants match.</li>}
        {filtered.map(({ p, phone, isMe, label }) => {
          return (
            <li key={p.JID} className="relative flex items-center gap-3 px-4 py-2 text-sm group">
              <ParticipantAvatar session={session} id={phone ? `${phone}@c.us` : p.JID} name={label} size={40} />
              <span className="flex-1 min-w-0">
                <span className="block truncate selectable font-medium">{label}</span>
                {phone && label !== `+${phone}` && <span className="block text-xs text-neutral-500 selectable">+{phone}</span>}
              </span>
              {p.IsSuperAdmin ? (
                <Crown size={14} className="text-amber-500" />
              ) : p.IsAdmin ? (
                <Shield size={14} className="text-emerald-600" />
              ) : null}
              {amAdmin && !isMe && !p.IsSuperAdmin && (
                <button
                  onClick={() => setMenu(menu === p.JID ? null : p.JID)}
                  className="opacity-0 group-hover:opacity-100 data-[open=true]:opacity-100 text-neutral-400 hover:text-neutral-700"
                  data-open={menu === p.JID}
                  title="Manage"
                >
                  {busy === p.JID ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={14} />}
                </button>
              )}
              {menu === p.JID && (
                <div className="absolute right-4 top-full z-30 w-44 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 text-xs" onMouseDown={(e) => e.stopPropagation()}>
                  {p.IsAdmin ? (
                    <MenuItem onClick={() => act("Dismiss admin", p, () => requireClient().demoteAdmins(session, chatId, [pid(p)]))}>Dismiss as admin</MenuItem>
                  ) : (
                    <MenuItem onClick={() => act("Make admin", p, () => requireClient().promoteAdmins(session, chatId, [pid(p)]))}>Make group admin</MenuItem>
                  )}
                  <MenuItem
                    danger
                    onClick={async () => {
                      if (await confirm({ title: `Remove ${label} from the group?`, danger: true, confirmLabel: "Confirm" })) void act("Remove", p, () => requireClient().removeParticipants(session, chatId, [pid(p)]));
                    }}
                  >
                    Remove from group
                  </MenuItem>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
    </div>
  );
}

/** Avatar that lazily fetches the WhatsApp profile picture for a participant id. */
function ParticipantAvatar({ session, id, name, size = 28 }: { session: string; id: string; name: string; size?: number }) {
  const pic = useQuery({
    queryKey: ["profile-picture", session, id],
    queryFn: () => requireClient().profilePicture(session, id).then((r) => r.profilePictureURL),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 0,
  });
  return <Avatar src={pic.data ?? undefined} name={name} size={size} />;
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800", danger && "text-red-600")}>
      {children}
    </button>
  );
}

/** Admin tools: add member, invite link, rename, description, leave. */
export function GroupTools({
  session,
  chatId,
  group,
  myIds,
  resolveName,
  onLeft,
}: {
  session: string;
  chatId: string;
  group: GowsGroup;
  myIds: string[];
  resolveName: MentionResolver;
  onLeft: () => void;
}) {
  const qc = useQueryClient();
  const { amAdmin } = useAmAdmin(group, myIds);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState<"subject" | "description" | null>(null);
  const [text, setText] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (name: string, fn: () => Promise<unknown>, refresh = true) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
      if (refresh) await qc.invalidateQueries({ queryKey: ["group", session, chatId] });
      return true;
    } catch (e) {
      setErr(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-b border-neutral-100 dark:border-neutral-800">
      {err && <div className="px-4 py-1 text-xs text-red-600 selectable">{err}</div>}
      {amAdmin && <JoinRequests session={session} chatId={chatId} resolveName={resolveName} />}
      {amAdmin && (
        <>
          <Row icon={UserPlus} label="Add member" onClick={() => setAdding((v) => !v)} />
          {adding && (
            <form
              className="flex gap-2 px-4 pb-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = phone.replace(/\D/g, "");
                if (d.length < 8) return;
                if (await run("Add", () => requireClient().addParticipants(session, chatId, [`${d}@c.us`]))) {
                  setPhone("");
                  setAdding(false);
                }
              }}
            >
              <Input placeholder="628123456789" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
              <Button size="sm" type="submit" disabled={busy === "Add"}>{busy === "Add" ? <Loader2 size={12} className="animate-spin" /> : "Add"}</Button>
            </form>
          )}
          <Row icon={Pencil} label="Change group name" onClick={() => { setEditing("subject"); setText(group.Name); }} />
          <Row icon={Pencil} label="Change description" onClick={() => { setEditing("description"); setText(group.Topic ?? ""); }} />
          {editing && (
            <div className="px-4 pb-2 space-y-1.5">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={editing === "subject" ? 1 : 4}
                autoFocus
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm outline-none"
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={busy === "Save"}
                  onClick={async () => {
                    const ok = await run("Save", () =>
                      editing === "subject"
                        ? requireClient().setGroupSubject(session, chatId, text.trim())
                        : requireClient().setGroupDescription(session, chatId, text.trim()),
                    );
                    if (ok) {
                      setEditing(null);
                      qc.invalidateQueries({ queryKey: qk.chats(session) });
                    }
                  }}
                >
                  {busy === "Save" ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <Row
        icon={LinkIcon}
        label={invite ? "Invite link" : "Show invite link"}
        onClick={async () => {
          if (invite) return;
          await run("Invite link", async () => setInvite(String(await requireClient().groupInviteCode(session, chatId))), false);
        }}
        busy={busy === "Invite link"}
      />
      {invite && (
        <div className="flex items-center gap-2 px-4 pb-2">
          <code className="flex-1 min-w-0 truncate text-[11px] selectable">{invite}</code>
          <button
            title="Copy"
            onClick={() => {
              void navigator.clipboard.writeText(invite);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          </button>
          {amAdmin && (
            <button
              title="Revoke and create a new link"
              onClick={async () => {
                if (await confirm({ title: "Revoke the current invite link? Old links stop working.", danger: true, confirmLabel: "Confirm" })) void run("Revoke", async () => setInvite(String(await requireClient().revokeGroupInviteCode(session, chatId))), false);
              }}
            >
              <RefreshCw size={14} className={cn(busy === "Revoke" && "animate-spin")} />
            </button>
          )}
        </div>
      )}
      <Row
        icon={LogOut}
        label="Leave group"
        danger
        busy={busy === "Leave"}
        onClick={async () => {
          if (!(await confirm({ title: `Leave "${group.Name}"?`, danger: true, confirmLabel: "Confirm" }))) return;
          if (await run("Leave", () => requireClient().leaveGroup(session, chatId), false)) {
            qc.invalidateQueries({ queryKey: qk.chats(session) });
            onLeft();
          }
        }}
      />
    </div>
  );
}

function Row({ icon: Icon, label, onClick, danger, busy, highlight }: { icon: typeof UserPlus; label: string; onClick: () => void; danger?: boolean; busy?: boolean; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
        danger && "text-red-600",
        highlight && "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 font-medium",
      )}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} className={danger ? "" : highlight ? "text-amber-600" : "text-wa-dark"} />}
      <span className="flex-1">{label}</span>
      {highlight && <span className="text-xs">›</span>}
    </button>
  );
}

/** Pending join requests: a count row that opens a modal with photo, name and phone per request. */
function JoinRequests({ session, chatId, resolveName }: { session: string; chatId: string; resolveName: MentionResolver }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["join-requests", session, chatId],
    queryFn: () => requireClient().joinRequests(session, chatId),
    refetchInterval: 60_000,
  });
  const list = q.data ?? [];
  if (q.isError || !list.length) return null;
  return (
    <>
      <Row
        icon={UserCheck}
        label={`${list.length} pending join request${list.length === 1 ? "" : "s"}`}
        onClick={() => setOpen(true)}
        highlight
      />
      {open && <JoinRequestsModal session={session} chatId={chatId} resolveName={resolveName} requests={list} onClose={() => setOpen(false)} />}
    </>
  );
}

function JoinRequestsModal({
  session,
  chatId,
  resolveName,
  requests,
  onClose,
}: {
  session: string;
  chatId: string;
  resolveName: MentionResolver;
  requests: JoinRequest[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const idOf = (r: JoinRequest) => r.requesterId;
  const decide = async (r: JoinRequest, approve: boolean) => {
    const id = idOf(r);
    setBusy(id);
    setErr(null);
    try {
      if (approve) await requireClient().approveJoinRequests(session, chatId, [id]);
      else await requireClient().rejectJoinRequests(session, chatId, [id]);
      await qc.invalidateQueries({ queryKey: ["join-requests", session, chatId] });
      await qc.invalidateQueries({ queryKey: ["group", session, chatId] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[440px] max-h-[75vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <UserCheck size={16} className="text-wa-dark" />
          <span className="font-semibold flex-1">Join requests ({requests.length})</span>
          <button onClick={onClose}><XIcon size={16} /></button>
        </div>
        {err && <div className="px-4 py-1 text-xs text-red-600 selectable">{err}</div>}
        <ul className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
          {requests.map((r) => (
            <JoinRequestRow key={idOf(r)} session={session} id={idOf(r)} request={r} resolveName={resolveName} busy={busy === idOf(r)} onDecide={(ok) => decide(r, ok)} />
          ))}
          {requests.length === 0 && <li className="p-6 text-sm text-neutral-500 text-center">No pending requests.</li>}
        </ul>
      </div>
    </div>
  );
}

function JoinRequestRow({
  session,
  id,
  request,
  resolveName,
  busy,
  onDecide,
}: {
  session: string;
  id: string;
  request: JoinRequest;
  resolveName: MentionResolver;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  // Requests only carry a LID; resolve phone number, name and picture from it.
  const pn = useQuery({
    queryKey: ["lid-pn", session, id],
    queryFn: () => requireClient().lidToPhone(session, id).then((r) => r.pn),
    enabled: id.endsWith("@lid"),
    staleTime: Infinity,
    retry: 0,
  });
  const phoneDigits = (pn.data ?? (id.endsWith("@c.us") ? id : "")).split("@")[0] ?? "";
  const pic = useQuery({
    queryKey: ["profile-picture", session, id],
    queryFn: () => requireClient().profilePicture(session, id).then((r) => r.profilePictureURL),
    staleTime: 10 * 60_000,
    retry: 0,
  });
  const contact = useQuery({
    queryKey: ["contact", session, id],
    queryFn: () => requireClient().contactInfo(session, id),
    staleTime: 10 * 60_000,
    retry: 0,
  });
  const name =
    resolveName(id) ??
    (phoneDigits ? resolveName(`${phoneDigits}@c.us`) : undefined) ??
    contact.data?.name ??
    (contact.data?.pushname ? `~${contact.data.pushname}` : null) ??
    (phoneDigits ? `+${phoneDigits}` : displayId(id));
  const when = request.timestamp;
  const whenText = when ? new Date(when * 1000).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Avatar src={pic.data ?? undefined} name={name} size={44} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate selectable">{name}</span>
        {phoneDigits && <span className="block text-xs text-neutral-500 selectable">+{phoneDigits}</span>}
        {phoneDigits === "" && pn.isLoading && <span className="block text-xs text-neutral-400">…</span>}
        {whenText && (
          <span className="block text-[10px] text-neutral-400">
            Requested {whenText}
            {request.requestMethod ? ` · ${String(request.requestMethod).replace(/_/g, " ").toLowerCase()}` : ""}
          </span>
        )}
      </span>
      <Button size="sm" disabled={busy} onClick={() => onDecide(true)} title="Approve">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(false)} title="Reject">
        <XIcon size={12} />
      </Button>
    </li>
  );
}
