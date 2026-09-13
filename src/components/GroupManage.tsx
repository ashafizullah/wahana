import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Crown, Shield, MoreVertical, UserPlus, Link as LinkIcon, RefreshCw, LogOut, Pencil, Loader2, Copy, Check } from "lucide-react";
import { requireClient } from "@/store/settings";
import { Avatar, Button, Input } from "@/components/ui";
import { cn, displayId } from "@/lib/utils";
import type { GowsGroup } from "@/api/types";
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

/** Participant list with admin actions (remove / promote / demote). */
export function ParticipantList({
  session,
  chatId,
  group,
  myIds,
  resolveName,
}: {
  session: string;
  chatId: string;
  group: GowsGroup;
  myIds: string[];
  resolveName: MentionResolver;
}) {
  const qc = useQueryClient();
  const { amAdmin, meP } = useAmAdmin(group, myIds);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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

  const sorted = [...(group.Participants ?? [])].sort(
    (a, b) => Number(b.IsSuperAdmin) - Number(a.IsSuperAdmin) || Number(b.IsAdmin) - Number(a.IsAdmin),
  );

  return (
    <div ref={ref}>
      {err && <div className="px-4 py-1 text-xs text-red-600 selectable">{err}</div>}
      <ul>
        {sorted.map((p) => {
          const phone = p.PhoneNumber?.split("@")[0];
          const isMe = p.JID === meP?.JID;
          const label = isMe ? "You" : resolveName(p.JID) ?? p.DisplayName ?? (phone ? `+${phone}` : displayId(p.JID));
          return (
            <li key={p.JID} className="relative flex items-center gap-2 px-4 py-1.5 text-sm group">
              <Avatar name={label} size={28} />
              <span className="flex-1 min-w-0">
                <span className="block truncate selectable">{label}</span>
                {phone && label !== `+${phone}` && <span className="block text-[10px] text-neutral-500 selectable">+{phone}</span>}
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
                <div className="absolute right-4 top-full z-30 w-44 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 text-xs">
                  {p.IsAdmin ? (
                    <MenuItem onClick={() => act("Dismiss admin", p, () => requireClient().demoteAdmins(session, chatId, [pid(p)]))}>Dismiss as admin</MenuItem>
                  ) : (
                    <MenuItem onClick={() => act("Make admin", p, () => requireClient().promoteAdmins(session, chatId, [pid(p)]))}>Make group admin</MenuItem>
                  )}
                  <MenuItem
                    danger
                    onClick={() => {
                      if (window.confirm(`Remove ${label} from the group?`)) void act("Remove", p, () => requireClient().removeParticipants(session, chatId, [pid(p)]));
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
  );
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
  onLeft,
}: {
  session: string;
  chatId: string;
  group: GowsGroup;
  myIds: string[];
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
              onClick={() => {
                if (window.confirm("Revoke the current invite link? Old links stop working.")) void run("Revoke", async () => setInvite(String(await requireClient().revokeGroupInviteCode(session, chatId))), false);
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
          if (!window.confirm(`Leave "${group.Name}"?`)) return;
          if (await run("Leave", () => requireClient().leaveGroup(session, chatId), false)) {
            qc.invalidateQueries({ queryKey: qk.chats(session) });
            onLeft();
          }
        }}
      />
    </div>
  );
}

function Row({ icon: Icon, label, onClick, danger, busy }: { icon: typeof UserPlus; label: string; onClick: () => void; danger?: boolean; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn("w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60", danger ? "text-red-600" : "")}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} className={danger ? "" : "text-wa-dark"} />}
      {label}
    </button>
  );
}
