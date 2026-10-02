import { useState } from "react";
import { BadgeCheck, BellOff, Calendar, Copy, LogOut, Megaphone, Pencil, Users } from "lucide-react";
import { Dialog } from "@/components/AttachMenu";
import { confirm } from "@/components/Confirm";
import { Button, Input } from "@/components/ui";
import { nativeWa, type NativeChannelDetails } from "@/lib/nativeWa";
import { errMsg } from "@/lib/utils";

const mutedKey = (accountId: string, chatId: string) => `wa-channel-muted:${accountId}:${chatId}`;

/** WhatsApp does not report a channel's mute state, so the last choice made here is remembered. */
function readMuted(accountId: string, chatId: string) {
  try {
    return localStorage.getItem(mutedKey(accountId, chatId)) === "1";
  } catch {
    return false;
  }
}

function Row({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      <Icon size={15} className="text-wa-dark shrink-0" />
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

/** Followers, verification, link, mute and unfollow for a channel in the info panel. */
export function NativeChannelRows({
  accountId,
  details: d,
  connected,
  onLeft,
  onChanged,
}: {
  accountId: string;
  details: NativeChannelDetails;
  connected: boolean;
  onLeft: () => void;
  /** The name or description was changed: reload the details. */
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [muted, setMuted] = useState(() => readMuted(accountId, d.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const manager = d.role === "owner" || d.role === "admin";

  const toggleMute = async () => {
    setBusy(true);
    setError(null);
    try {
      await nativeWa.channelMute(accountId, d.id, !muted);
      setMuted(!muted);
      try {
        localStorage.setItem(mutedKey(accountId, d.id), muted ? "0" : "1");
      } catch {
        /* the toggle still worked, it is just not remembered */
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const unfollow = async () => {
    const ok = await confirm({
      title: `Unfollow ${d.name}?`,
      message: "Removes the channel and its stored posts from this account. You can follow it again from its link.",
      confirmLabel: "Unfollow",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await nativeWa.channelLeave(accountId, d.id);
      onLeft();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!d.inviteLink) return;
    await navigator.clipboard.writeText(d.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="py-1 border-b border-neutral-100 dark:border-neutral-800">
        <Row icon={Users}>
          {d.subscribers.toLocaleString()} follower{d.subscribers === 1 ? "" : "s"}
        </Row>
        {d.verified && <Row icon={BadgeCheck}>Verified channel</Row>}
        {manager && <Row icon={Megaphone}>You {d.role === "owner" ? "own" : "manage"} this channel</Row>}
        {d.createdAt && <Row icon={Calendar}>Created {new Date(d.createdAt).toLocaleDateString()}</Row>}
      </div>
      <div className="py-1 border-b border-neutral-100 dark:border-neutral-800">
        {manager && (
          <button
            onClick={() => setEditing(true)}
            disabled={!connected}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 disabled:opacity-50"
          >
            <Pencil size={15} className="text-wa-dark shrink-0" />
            <span className="flex-1">Edit name and description</span>
          </button>
        )}
        {d.inviteLink && (
          <button
            onClick={() => void copyLink()}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <Copy size={15} className="text-wa-dark shrink-0" />
            <span className="flex-1 min-w-0 truncate">{copied ? "Copied" : "Copy channel link"}</span>
          </button>
        )}
        <button
          onClick={() => void toggleMute()}
          disabled={busy || !connected}
          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60 disabled:opacity-50"
        >
          <BellOff size={15} className="text-wa-dark shrink-0" />
          <span className="flex-1">{muted ? "Unmute notifications" : "Mute notifications"}</span>
        </button>
        <button
          onClick={() => void unfollow()}
          disabled={busy || !connected}
          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left text-red-600 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 disabled:opacity-50"
        >
          <LogOut size={15} className="shrink-0" />
          <span className="flex-1">Unfollow channel</span>
        </button>
      </div>
      {error && <div className="p-4 text-xs text-red-600 selectable">{error}</div>}
      {editing && (
        <EditChannel
          accountId={accountId}
          details={d}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

/** Rename a channel or change its description (owners and admins). */
function EditChannel({
  accountId,
  details: d,
  onSaved,
  onClose,
}: {
  accountId: string;
  details: NativeChannelDetails;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(d.name);
  const [description, setDescription] = useState(d.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await nativeWa.channelUpdate(
        accountId,
        d.id,
        name.trim() !== d.name ? name.trim() : null,
        description.trim() !== (d.description ?? "") ? description.trim() : null,
      );
      onSaved();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Edit channel" onClose={onClose}>
      <div className="p-4 space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name" maxLength={100} />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          rows={4}
          maxLength={2048}
          className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none"
        />
        {error && <div className="text-xs text-red-600 selectable">{error}</div>}
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Follow a channel from its invite link. */
export function NativeFollowChannel({
  accountId,
  onFollowed,
  onClose,
}: {
  accountId: string;
  onFollowed: (chatId: string) => void;
  onClose: () => void;
}) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const follow = async () => {
    setBusy(true);
    setError(null);
    try {
      const chatId = await nativeWa.channelFollow(accountId, link);
      onFollowed(chatId);
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Follow a channel" onClose={onClose}>
      <div className="p-4 space-y-3">
        <Input
          autoFocus
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && link.trim() && !busy && void follow()}
          placeholder="https://whatsapp.com/channel/…"
        />
        {error && <div className="text-xs text-red-600 selectable">{error}</div>}
        <div className="flex justify-end">
          <Button onClick={() => void follow()} disabled={busy || !link.trim()}>
            {busy ? "Following…" : "Follow"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
