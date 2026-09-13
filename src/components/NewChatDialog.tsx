import { useMemo, useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";
import { Dialog } from "@/components/AttachMenu";
import { Avatar, Button, Input } from "@/components/ui";
import { useContacts } from "@/api/queries";
import { requireClient } from "@/store/settings";
import { displayId } from "@/lib/utils";

/** Start a conversation with a phone number or a saved contact. */
export function NewChatDialog({ session, onPick, onClose }: { session: string; onPick: (chatId: string) => void; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: contacts, isLoading } = useContacts(session);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (contacts ?? [])
      .filter((c) => c.name || c.pushname)
      .filter((c) => !term || (c.name ?? "").toLowerCase().includes(term) || (c.pushname ?? "").toLowerCase().includes(term) || c.id.includes(term))
      .sort((a, b) => (a.name || a.pushname || "").localeCompare(b.name || b.pushname || ""))
      .slice(0, 200);
  }, [contacts, q]);

  const check = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await requireClient().checkExists(session, digits);
      if (!r.numberExists) {
        setErr("This number is not on WhatsApp.");
        return;
      }
      // Prefer the phone-number id; fall back to whatever the server returned.
      onPick((r as { pn?: string }).pn ?? r.chatId ?? `${digits}@c.us`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New chat" onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <Input placeholder="Phone with country code, e.g. 628123456789" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
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
              onClick={() => {
                onPick(c.id);
                onClose();
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg"
            >
              <Avatar name={name} size={30} />
              <span className="min-w-0">
                <span className="block truncate">{name}</span>
                <span className="block text-[11px] text-neutral-500 truncate">{c.pushname && c.name ? `~${c.pushname} · ` : ""}{displayId(c.id)}</span>
              </span>
            </button>
          );
        })}
        {!isLoading && list.length === 0 && <p className="text-xs text-neutral-500 px-2 py-3">No contacts match.</p>}
      </div>
    </Dialog>
  );
}
