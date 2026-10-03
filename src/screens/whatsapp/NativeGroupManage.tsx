import { FloatingMenu } from "@/components/FloatingMenu";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Download,
  Link as LinkIcon,
  Loader2,
  Lock,
  LogOut,
  Pencil,
  RefreshCw,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Avatar, Button, Input } from "@/components/ui";
import { confirm } from "@/components/Confirm";
import { nativeWa, type NativeGroupAction, type NativeGroupDetails, type NativeGroupMember, type NativeJoinRequest } from "@/lib/nativeWa";
import { cn, errMsg } from "@/lib/utils";
import { usePicture } from "@/screens/whatsapp/usePicture";

/**
 * Group management for native WhatsApp accounts, mirroring the WAHA panel's tools
 * (`components/GroupManage`): join requests, add member, photo, settings, name and
 * description, invite link, export, leave. Admin-only tools show only to admins.
 */

/** Runs a group action and reports the outcome; `refresh` reloads the panel. */
export function useGroupAction(accountId: string, chatId: string, refresh: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (label: string, action: NativeGroupAction, reload = true) => {
    setBusy(label);
    setErr(null);
    try {
      const result = await nativeWa.groupAction(accountId, chatId, action);
      if (result.failed.length) setErr(`${label}: ${result.failed.join("; ")}`);
      if (reload) refresh();
      return result;
    } catch (e) {
      setErr(`${label}: ${errMsg(e)}`);
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, err, setErr, run };
}

/** Square-crops an image and encodes it as a 640px JPEG, the size WhatsApp keeps. */
async function groupPhotoJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(640, side);
  canvas
    .getContext("2d")!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1]!;
}

export function NativeGroupTools({
  accountId,
  connected,
  group,
  amAdmin,
  refresh,
  onLeft,
}: {
  accountId: string;
  connected: boolean;
  group: NativeGroupDetails;
  amAdmin: boolean;
  refresh: () => void;
  onLeft: () => void;
}) {
  const { busy, err, run } = useGroupAction(accountId, group.id, refresh);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState<"subject" | "description" | null>(null);
  const [text, setText] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const picRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border-b border-neutral-100 dark:border-neutral-800">
      {err && <div className="px-4 py-1 text-xs text-red-600 selectable">{err}</div>}
      {amAdmin && <JoinRequests accountId={accountId} connected={connected} group={group} refresh={refresh} />}
      {amAdmin && (
        <>
          <Row icon={UserPlus} label="Add member" onClick={() => setAdding((v) => !v)} />
          {adding && (
            <form
              className="flex gap-2 px-4 pb-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (phone.replace(/\D/g, "").length < 8) return;
                const result = await run("Add", { type: "add", phones: [phone] });
                if (result && !result.failed.length) {
                  setPhone("");
                  setAdding(false);
                }
              }}
            >
              <Input placeholder="628123456789" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
              <Button size="sm" type="submit" disabled={busy === "Add"}>
                {busy === "Add" ? <Loader2 size={12} className="animate-spin" /> : "Add"}
              </Button>
            </form>
          )}
          <input
            ref={picRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await run("Photo", { type: "setPicture", jpeg: await groupPhotoJpeg(f) });
            }}
          />
          <Row icon={Camera} label="Change group photo" busy={busy === "Photo"} onClick={() => picRef.current?.click()} />
          <Row icon={Lock} label="Group settings" onClick={() => setSettingsOpen((v) => !v)} />
          {settingsOpen && (
            <div className="px-4 pb-2 space-y-2">
              <SettingToggle
                label="Only admins can send messages"
                checked={group.announce}
                busy={busy === "announce"}
                onChange={(on) => run("announce", { type: "setAnnounce", on })}
              />
              <SettingToggle
                label="Only admins can edit group info"
                checked={group.locked}
                busy={busy === "locked"}
                onChange={(on) => run("locked", { type: "setLocked", on })}
              />
              <SettingToggle
                label="Approve new members"
                checked={group.approval}
                busy={busy === "approval"}
                onChange={(on) => run("approval", { type: "setApproval", on })}
              />
            </div>
          )}
        </>
      )}
      {(amAdmin || !group.locked) && (
        <>
          <Row
            icon={Pencil}
            label="Change group name"
            onClick={() => {
              setEditing("subject");
              setText(group.subject);
            }}
          />
          <Row
            icon={Pencil}
            label="Change description"
            onClick={() => {
              setEditing("description");
              setText(group.description ?? "");
            }}
          />
        </>
      )}
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
            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy === "Save" || (editing === "subject" && !text.trim())}
              onClick={async () => {
                const ok = await run(
                  "Save",
                  editing === "subject"
                    ? { type: "setSubject", subject: text.trim() }
                    : { type: "setDescription", description: text.trim() },
                );
                if (ok) setEditing(null);
              }}
            >
              {busy === "Save" ? <Loader2 size={12} className="animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      )}
      {amAdmin && (
        <>
          <Row
            icon={LinkIcon}
            label={invite ? "Invite link" : "Show invite link"}
            busy={busy === "Invite link"}
            onClick={async () => {
              if (invite) return;
              const r = await run("Invite link", { type: "inviteLink", reset: false }, false);
              if (r?.inviteLink) setInvite(r.inviteLink);
            }}
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
              <button
                title="Revoke and create a new link"
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: "Revoke the current invite link? Old links stop working.",
                      danger: true,
                      confirmLabel: "Confirm",
                    }))
                  )
                    return;
                  const r = await run("Revoke", { type: "inviteLink", reset: true }, false);
                  if (r?.inviteLink) setInvite(r.inviteLink);
                }}
              >
                <RefreshCw size={14} className={cn(busy === "Revoke" && "animate-spin")} />
              </button>
            </div>
          )}
        </>
      )}
      <Row
        icon={Download}
        label="Export participants (CSV)"
        onClick={async () => {
          const path = await save({
            defaultPath: `${group.subject.replace(/[^\w.-]+/g, "_")}-participants.csv`,
            filters: [{ name: "CSV", extensions: ["csv"] }],
          });
          if (!path) return;
          const rows = [["name", "phone", "id", "admin"]];
          for (const m of group.members)
            rows.push([m.isMe ? "You" : (m.name ?? ""), m.phone ?? "", m.id, m.superAdmin ? "owner" : m.admin ? "admin" : ""]);
          await writeTextFile(path, rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n"));
        }}
      />
      <Row
        icon={LogOut}
        label="Leave group"
        danger
        busy={busy === "Leave"}
        onClick={async () => {
          if (!(await confirm({ title: `Leave "${group.subject}"?`, danger: true, confirmLabel: "Confirm" }))) return;
          if (await run("Leave", { type: "leave" }, false)) onLeft();
        }}
      />
    </div>
  );
}

/** Admin actions on one participant, for the participants dialog. */
export function MemberMenu({
  accountId,
  groupId,
  member: m,
  label,
  anchor,
  refresh,
  onError,
  onClose,
}: {
  accountId: string;
  groupId: string;
  member: NativeGroupMember;
  label: string;
  anchor: HTMLElement | null;
  refresh: () => void;
  onError: (e: string) => void;
  onClose: () => void;
}) {
  const act = async (name: string, action: NativeGroupAction) => {
    onClose();
    try {
      const r = await nativeWa.groupAction(accountId, groupId, action);
      if (r.failed.length) onError(`${name}: ${r.failed.join("; ")}`);
      refresh();
    } catch (e) {
      onError(`${name}: ${errMsg(e)}`);
    }
  };
  const item = "w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800";
  return (
    <FloatingMenu anchor={anchor} onClose={onClose}>
      {m.admin ? (
        <button className={item} onClick={() => act("Dismiss admin", { type: "demote", members: [m.id] })}>
          Dismiss as admin
        </button>
      ) : (
        <button className={item} onClick={() => act("Make admin", { type: "promote", members: [m.id] })}>
          Make group admin
        </button>
      )}
      <button
        className={cn(item, "text-red-600")}
        onClick={async () => {
          if (await confirm({ title: `Remove ${label} from the group?`, danger: true, confirmLabel: "Confirm" }))
            void act("Remove", { type: "remove", members: [m.id] });
          else onClose();
        }}
      >
        Remove from group
      </button>
    </FloatingMenu>
  );
}

function Row({
  icon: Icon,
  label,
  onClick,
  danger,
  busy,
  highlight,
}: {
  icon: typeof UserPlus;
  label: string;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
        danger && "text-red-600",
        highlight && "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 font-medium",
      )}
    >
      {busy ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <Icon size={15} className={danger ? "" : highlight ? "text-amber-600" : "text-wa-dark"} />
      )}
      <span className="flex-1">{label}</span>
      {highlight && <span className="text-xs">›</span>}
    </button>
  );
}

function SettingToggle({
  label,
  checked,
  busy,
  onChange,
}: {
  label: string;
  checked: boolean;
  busy?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm cursor-pointer">
      <span className="flex-1">{label}</span>
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={cn("relative h-5 w-9 rounded-full transition", checked ? "bg-wa-dark" : "bg-neutral-300 dark:bg-neutral-700")}
        >
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", checked ? "left-[18px]" : "left-0.5")} />
        </button>
      )}
    </label>
  );
}

// ── Join requests ──────────────────────────────────────────────────────

function JoinRequests({
  accountId,
  connected,
  group,
  refresh,
}: {
  accountId: string;
  connected: boolean;
  group: NativeGroupDetails;
  refresh: () => void;
}) {
  const [list, setList] = useState<NativeJoinRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      nativeWa
        .groupRequests(accountId, group.id)
        .then((r) => !cancelled && setList(r))
        .catch(() => !cancelled && setList([]));
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountId, group.id, tick]);

  if (!list.length) return null;
  return (
    <>
      <Row
        icon={UserCheck}
        label={`${list.length} pending join request${list.length === 1 ? "" : "s"}`}
        onClick={() => setOpen(true)}
        highlight
      />
      {open && (
        <JoinRequestsModal
          accountId={accountId}
          connected={connected}
          groupId={group.id}
          requests={list}
          onChanged={() => {
            setTick((t) => t + 1);
            refresh();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Whether a search term matches any of the texts; a phone number matches by its digits. */
function matchesTerm(term: string, ...texts: (string | null | undefined)[]) {
  const t = term.trim().toLowerCase().replace(/^\+/, "");
  if (!t) return true;
  const digits = t.replace(/\D/g, "");
  return texts.some((x) => {
    const s = (x ?? "").toLowerCase();
    return s.includes(t) || (digits.length > 0 && s.replace(/\D/g, "").includes(digits));
  });
}

function JoinRequestsModal({
  accountId,
  connected,
  groupId,
  requests,
  onChanged,
  onClose,
}: {
  accountId: string;
  connected: boolean;
  groupId: string;
  requests: NativeJoinRequest[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const shown = requests.filter((r) => matchesTerm(q, r.name, r.phone, r.id.split("@")[0]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const decide = async (r: NativeJoinRequest, approve: boolean) => {
    setBusy(r.id);
    setErr(null);
    try {
      const result = await nativeWa.groupAction(accountId, groupId, { type: approve ? "approve" : "reject", members: [r.id] });
      if (result.failed.length) setErr(result.failed.join("; "));
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
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
          <button onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-2 border-b border-neutral-100 dark:border-neutral-800">
          <Input placeholder="Search by name or phone number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {err && <div className="px-4 py-1 text-xs text-red-600 selectable">{err}</div>}
        <ul className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
          {shown.map((r) => (
            <JoinRequestRow
              key={r.id}
              accountId={accountId}
              connected={connected}
              request={r}
              busy={busy === r.id}
              onDecide={(ok) => decide(r, ok)}
            />
          ))}
          {shown.length === 0 && (
            <li className="p-6 text-sm text-neutral-500 text-center">
              {requests.length === 0 ? "No pending requests." : "No requests match."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function JoinRequestRow({
  accountId,
  connected,
  request: r,
  busy,
  onDecide,
}: {
  accountId: string;
  connected: boolean;
  request: NativeJoinRequest;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const picture = usePicture(accountId, r.id, connected);
  // Only an id is guaranteed; the phone number and name come in when WhatsApp answers.
  const name = r.name ? (r.saved ? r.name : `~${r.name}`) : (r.phone ?? r.id.split("@")[0]!);
  const when = r.requestedAt
    ? new Date(r.requestedAt).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Avatar src={picture} name={name} size={40} />
      <span className="flex-1 min-w-0">
        <span className="block truncate font-medium text-sm selectable">{name}</span>
        {r.phone && r.phone !== name && <span className="block text-xs text-neutral-500 truncate selectable">{r.phone}</span>}
        {when && <span className="block text-[10px] text-neutral-400">Requested {when}</span>}
      </span>
      {busy ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <>
          <Button size="sm" variant="secondary" onClick={() => onDecide(false)} title="Reject">
            <X size={14} />
          </Button>
          <Button size="sm" onClick={() => onDecide(true)} title="Approve">
            <Check size={14} />
          </Button>
        </>
      )}
    </li>
  );
}
