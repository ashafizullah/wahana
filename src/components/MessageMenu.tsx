import { useEffect, useRef, useState } from "react";
import { Reply, SmilePlus, Pencil, Trash2, Copy, Forward, Pin, Loader2, X, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { requireClient } from "@/store/settings";
import { qk, useChats } from "@/api/queries";
import type { WAMessage } from "@/api/types";
import { cn, displayId } from "@/lib/utils";
import { Button, Input, Avatar } from "@/components/ui";
import { useReactions } from "@/store/reactions";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export interface MenuPos {
  x: number;
  y: number;
}

/** Right-click context menu for a message bubble. */
export function MessageMenu({
  message: m,
  session,
  chatId,
  pos,
  onClose,
  onReply,
  onEdit,
}: {
  message: WAMessage;
  session: string;
  chatId: string;
  pos: MenuPos;
  onClose: () => void;
  onReply: () => void;
  onEdit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [forward, setForward] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu inside the viewport.
  const style: React.CSSProperties = {
    left: Math.min(pos.x, window.innerWidth - 240),
    top: Math.min(pos.y, window.innerHeight - 320),
  };

  const run = async (name: string, fn: () => Promise<unknown>, close = true) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: qk.messages(session, chatId) });
      if (close) onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = () => {
    if (!window.confirm("Delete this message?")) return;
    void run("delete", () => requireClient().deleteMessage(session, chatId, m.id));
  };

  const pinned = Boolean((m._data as { Info?: { Pinned?: boolean } } | undefined)?.Info?.Pinned);

  if (forward) {
    return (
      <ForwardDialog
        session={session}
        messageId={m.id}
        onClose={onClose}
      />
    );
  }

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-50 w-56 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 text-sm"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex justify-between px-2 py-1.5 border-b border-neutral-100 dark:border-neutral-800">
        {QUICK_REACTIONS.map((r) => (
          <button
            key={r}
            className="text-lg hover:scale-125 transition"
            onClick={() =>
              run("react", async () => {
                await requireClient().react(session, m.id, r);
                useReactions.getState().set(m.id, "me", r);
              })
            }
          >
            {r}
          </button>
        ))}
      </div>
      <Item icon={Reply} label="Reply" onClick={() => { onReply(); onClose(); }} />
      <Item
        icon={SmilePlus}
        label="Remove reaction"
        onClick={() =>
          run("unreact", async () => {
            await requireClient().react(session, m.id, "");
            useReactions.getState().set(m.id, "me", "");
          })
        }
      />
      {m.body && (
        <Item
          icon={Copy}
          label="Copy text"
          onClick={() => {
            void navigator.clipboard.writeText(m.body);
            onClose();
          }}
        />
      )}
      <Item icon={Forward} label="Forward…" onClick={() => setForward(true)} />
      <Item
        icon={Pin}
        label={pinned ? "Unpin" : "Pin (7 days)"}
        onClick={() =>
          run("pin", () =>
            pinned
              ? requireClient().unpinMessage(session, chatId, m.id)
              : requireClient().pinMessage(session, chatId, m.id),
          )
        }
      />
      {m.fromMe && m.body && !m.hasMedia && <Item icon={Pencil} label="Edit" onClick={() => { onEdit(); onClose(); }} />}
      {m.fromMe && <Item icon={Trash2} label="Delete for everyone" danger onClick={remove} />}
      {(busy || err) && (
        <div className="px-3 py-1.5 text-xs text-neutral-500 flex items-center gap-1 selectable">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <span className="text-red-600">{err}</span>}
        </div>
      )}
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Reply;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800",
        danger && "text-red-600",
      )}
    >
      <Icon size={15} className="opacity-70" />
      {label}
    </button>
  );
}

function ForwardDialog({ session, messageId, onClose }: { session: string; messageId: string; onClose: () => void }) {
  const { data: chats } = useChats(session);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const term = q.trim().toLowerCase();
  const list = (chats ?? [])
    .filter((c) => c.id !== "status@broadcast" && !c.id.endsWith("@newsletter"))
    .filter((c) => !term || (c.name ?? "").toLowerCase().includes(term) || c.id.includes(term))
    .slice(0, 50);

  const send = async (toChatId: string) => {
    setBusy(toChatId);
    setErr(null);
    try {
      await requireClient().forwardMessage(session, toChatId, messageId);
      setDone((d) => new Set(d).add(toChatId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[380px] max-h-[70vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <span className="font-semibold flex-1">Forward to…</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-2 relative">
          <Search size={14} className="absolute left-4 top-4.5 text-neutral-400" />
          <Input className="pl-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {err && <div className="px-3 text-xs text-red-600 selectable">{err}</div>}
        <div className="flex-1 overflow-y-auto">
          {list.map((c) => {
            const name = c.name || displayId(c.id);
            return (
              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                <Avatar src={c.picture} name={name} size={30} />
                <span className="flex-1 truncate text-sm">{name}</span>
                <Button size="sm" variant={done.has(c.id) ? "secondary" : "primary"} disabled={busy === c.id || done.has(c.id)} onClick={() => send(c.id)}>
                  {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : done.has(c.id) ? "Sent" : "Send"}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
