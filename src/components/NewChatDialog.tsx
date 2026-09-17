import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, UserPlus, Users, Link as LinkIcon, Megaphone, Check, Plus } from "lucide-react";
import { Dialog } from "@/components/AttachMenu";
import { Avatar, Button, Input, Label } from "@/components/ui";
import { useContacts, qk } from "@/api/queries";
import { requireClient } from "@/store/settings";
import { cn, displayId, errMsg } from "@/lib/utils";

type Tab = "contacts" | "group" | "join" | "channels";

/** Start a conversation, create/join a group, or browse channels. */
export function NewChatDialog({ session, onPick, onClose }: { session: string; onPick: (chatId: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("contacts");
  return (
    <Dialog title="New" onClose={onClose}>
      <div className="flex gap-1 -mt-1">
        {(
          [
            ["contacts", "Contact", UserPlus],
            ["group", "New group", Users],
            ["join", "Join link", LinkIcon],
            ["channels", "Channels", Megaphone],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
              tab === id ? "bg-wa-dark text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300",
            )}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      {tab === "contacts" && (
        <ContactsTab
          session={session}
          onPick={(id) => {
            onPick(id);
            onClose();
          }}
        />
      )}
      {tab === "group" && (
        <NewGroupTab
          session={session}
          onCreated={(id) => {
            onPick(id);
            onClose();
          }}
        />
      )}
      {tab === "join" && (
        <JoinTab
          session={session}
          onJoined={(id) => {
            onPick(id);
            onClose();
          }}
        />
      )}
      {tab === "channels" && (
        <ChannelsTab
          session={session}
          onOpen={(id) => {
            onPick(id);
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}

function useContactList(session: string, q: string) {
  const { data: contacts, isLoading } = useContacts(session);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (contacts ?? [])
      .filter((c) => c.name || c.pushname)
      .filter(
        (c) =>
          !term || (c.name ?? "").toLowerCase().includes(term) || (c.pushname ?? "").toLowerCase().includes(term) || c.id.includes(term),
      )
      .sort((a, b) => (a.name || a.pushname || "").localeCompare(b.name || b.pushname || ""))
      .slice(0, 300);
  }, [contacts, q]);
  return { list, isLoading };
}

function ContactsTab({ session, onPick }: { session: string; onPick: (id: string) => void }) {
  const [phone, setPhone] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { list, isLoading } = useContactList(session, q);

  const check = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await requireClient().checkExists(session, digits);
      if (!r.numberExists) return setErr("This number is not on WhatsApp.");
      onPick((r as { pn?: string }).pn ?? r.chatId ?? `${digits}@c.us`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <Input
          placeholder="Phone with country code, e.g. 628123456789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
        />
        <Button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 8}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
        </Button>
      </form>
      {err && <div className="text-xs text-red-600 selectable">{err}</div>}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
        <Input className="pl-8" placeholder="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[40vh] overflow-y-auto -mx-2">
        {isLoading && <Loader2 className="animate-spin text-neutral-400 m-2" />}
        {list.map((c) => {
          const name = c.name || c.pushname || displayId(c.id);
          return (
            <button
              key={c.id}
              onClick={() => onPick(c.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg"
            >
              <Avatar name={name} size={30} />
              <span className="min-w-0">
                <span className="block truncate">{name}</span>
                <span className="block text-[11px] text-neutral-500 truncate">
                  {c.pushname && c.name ? `~${c.pushname} · ` : ""}
                  {displayId(c.id)}
                </span>
              </span>
            </button>
          );
        })}
        {!isLoading && list.length === 0 && <p className="text-xs text-neutral-500 px-2 py-3">No contacts match.</p>}
      </div>
    </>
  );
}

function NewGroupTab({ session, onCreated }: { session: string; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { list } = useContactList(session, q);
  const phoneOnly = list.filter((c) => c.id.endsWith("@c.us"));

  return (
    <>
      <div>
        <Label>Group name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team Wahana" autoFocus maxLength={100} />
      </div>
      <div>
        <Label>Participants · {picked.size} selected</Label>
        <Input placeholder="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-800">
          {phoneOnly.map((c) => {
            const on = picked.has(c.id);
            const nm = c.name || c.pushname || displayId(c.id);
            return (
              <label
                key={c.id}
                className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (on) n.delete(c.id);
                      else n.add(c.id);
                      return n;
                    })
                  }
                />
                <Avatar name={nm} size={24} />
                <span className="flex-1 truncate">{nm}</span>
                <span className="text-[11px] text-neutral-500">{displayId(c.id)}</span>
              </label>
            );
          })}
        </div>
        <p className="text-[11px] text-neutral-500 mt-1">
          Only contacts with a phone id can be added at creation; others can join via invite link later.
        </p>
      </div>
      {err && <div className="text-xs text-red-600 selectable">{err}</div>}
      <div className="flex justify-end">
        <Button
          disabled={busy || !name.trim() || picked.size === 0}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const g = await requireClient().createGroup(session, name.trim(), [...picked]);
              const id = (g as { JID?: string; id?: string }).JID ?? (g as { id?: string }).id ?? "";
              qc.invalidateQueries({ queryKey: qk.chats(session) });
              if (id) onCreated(id);
              else setErr("Group created, but the server did not return its id — refresh the chat list.");
            } catch (e) {
              setErr(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create group
        </Button>
      </div>
    </>
  );
}

function JoinTab({ session, onJoined }: { session: string; onJoined: (id: string) => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const info = useQuery({
    queryKey: ["join-info", session, code],
    queryFn: () => requireClient().joinInfo(session, code.trim()),
    enabled: /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}|^[A-Za-z0-9]{15,}$/.test(code.trim()),
    retry: 0,
  });
  return (
    <>
      <div>
        <Label>Invite link or code</Label>
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://chat.whatsapp.com/…" autoFocus />
      </div>
      {info.isLoading && <Loader2 className="animate-spin text-neutral-400" />}
      {info.data && (
        <div className="flex items-center gap-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-3">
          <Avatar name={info.data.Name} size={40} />
          <span className="min-w-0">
            <span className="block font-medium truncate">{info.data.Name}</span>
            <span className="block text-xs text-neutral-500">
              {info.data.ParticipantCount ?? info.data.Participants?.length ?? "?"} participants
            </span>
          </span>
        </div>
      )}
      {info.error && <div className="text-xs text-red-600 selectable">{(info.error as Error).message}</div>}
      {err && <div className="text-xs text-red-600 selectable">{err}</div>}
      <div className="flex justify-end">
        <Button
          disabled={busy || !code.trim()}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const r = await requireClient().joinGroup(session, code.trim());
              qc.invalidateQueries({ queryKey: qk.chats(session) });
              onJoined(r.id);
            } catch (e) {
              setErr(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />} Join group
        </Button>
      </div>
    </>
  );
}

function ChannelsTab({ session, onOpen }: { session: string; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const mine = useQuery({ queryKey: ["channels", session], queryFn: () => requireClient().channels(session) });
  const search = useQuery({
    queryKey: ["channel-search", session, q.trim()],
    queryFn: () =>
      requireClient()
        .searchChannels(session, q.trim())
        .then((r) => r.channels ?? []),
    enabled: q.trim().length >= 2,
    retry: 0,
  });
  const followed = new Set((mine.data ?? []).map((c) => c.id));
  const list = q.trim().length >= 2 ? (search.data ?? []) : (mine.data ?? []);

  const toggle = async (id: string, isFollowed: boolean) => {
    setBusy(id);
    try {
      if (isFollowed) await requireClient().unfollowChannel(session, id);
      else await requireClient().followChannel(session, id);
      await qc.invalidateQueries({ queryKey: ["channels", session] });
      qc.invalidateQueries({ queryKey: qk.chats(session) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
        <Input
          className="pl-8"
          placeholder="Search channels (min 2 letters) — empty shows followed"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>
      <div className="max-h-[45vh] overflow-y-auto -mx-2">
        {(mine.isLoading || search.isLoading) && <Loader2 className="animate-spin text-neutral-400 m-2" />}
        {list.map((c) => {
          const isFollowed = followed.has(c.id);
          return (
            <div
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Avatar
                src={(c as { preview?: string; picture?: string }).preview || (c as { picture?: string }).picture || undefined}
                name={c.name}
                size={32}
              />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => isFollowed && onOpen(c.id)}
                title={isFollowed ? "Open" : "Follow to open"}
              >
                <span className="block truncate font-medium">
                  {c.name} {(c as { verified?: boolean }).verified && <Check size={12} className="inline text-sky-500" />}
                </span>
                <span className="block text-[11px] text-neutral-500 truncate">
                  {(c as { description?: string }).description ?? ""}
                  {(c as { subscribersCount?: number }).subscribersCount
                    ? ` · ${(c as { subscribersCount?: number }).subscribersCount} followers`
                    : ""}
                </span>
              </button>
              <Button
                size="sm"
                variant={isFollowed ? "secondary" : "primary"}
                disabled={busy === c.id}
                onClick={() => toggle(c.id, isFollowed)}
              >
                {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : isFollowed ? "Unfollow" : "Follow"}
              </Button>
            </div>
          );
        })}
        {!mine.isLoading && list.length === 0 && (
          <p className="text-xs text-neutral-500 px-2 py-3">
            {q.trim().length >= 2 ? "No channels found." : "You don't follow any channels yet — search above."}
          </p>
        )}
      </div>
    </>
  );
}
