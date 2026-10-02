import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { nativeWa, onNativeAccount, onNativeChats, onNativeMessages, onNativeQr, type NativeAccount, type NativeQr } from "@/lib/nativeWa";
import { nativeAccountKey } from "@/lib/account";
import { notifyText } from "@/realtime/notify";

/**
 * Native WhatsApp accounts (no server needed), driven by the Rust client. They sit next to
 * WAHA sessions in the session picker; `active` non-null means the chat screen shows that
 * account instead of WAHA. The account list itself is owned and persisted by the backend;
 * only the picker's choice is kept here.
 */

const STORE_FILE = "whatsapp.json";
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} }));

interface State {
  accounts: NativeAccount[];
  hydrated: boolean;
  active: string | null;
  /** Latest pairing code per account, while it is waiting for a scan. */
  qr: Record<string, NativeQr>;
  /** The chat on screen, so it does not raise a notification while you are reading it. */
  openChat: { account: string; chat: string } | null;
  /** Bumped whenever chats or messages change, so screens know to re-read them. */
  messageTick: number;
  hydrate: () => Promise<void>;
  add: (name?: string) => Promise<NativeAccount>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  setOpenChat: (open: { account: string; chat: string } | null) => void;
}

const sortAccounts = (list: NativeAccount[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));

function upsert(list: NativeAccount[], account: NativeAccount) {
  return sortAccounts([...list.filter((a) => a.id !== account.id), account]);
}

export const useWhatsApp = create<State>((set, get) => ({
  accounts: [],
  hydrated: false,
  active: null,
  qr: {},
  openChat: null,
  messageTick: 0,
  async hydrate() {
    if (get().hydrated) return;
    await onNativeAccount((account) =>
      set((st) => {
        const qr = account.status === "qr" ? st.qr : (({ [account.id]: _, ...rest }) => rest)(st.qr);
        return { accounts: upsert(st.accounts, account), qr };
      }),
    );
    await onNativeQr((qr) => set((st) => ({ qr: { ...st.qr, [qr.id]: qr } })));
    await onNativeChats(() => set((st) => ({ messageTick: st.messageTick + 1 })));
    await onNativeMessages(({ id, messages }) => {
      set((st) => ({ messageTick: st.messageTick + 1 }));
      const { accounts, openChat } = get();
      const account = accounts.find((a) => a.id === id);
      for (const m of messages) {
        if (m.fromMe) continue;
        // Feed the auto-reply runner the same shape the WAHA socket uses.
        window.dispatchEvent(
          new CustomEvent("wahana:incoming", {
            detail: {
              account: nativeAccountKey(id),
              chatId: m.chatId,
              message: {
                id: m.id,
                timestamp: Math.floor(m.timestamp / 1000),
                fromMe: m.fromMe,
                from: m.chatId,
                body: m.body,
                hasMedia: !!m.media,
                _data: { Info: { PushName: m.senderName || undefined } },
              },
            },
          }),
        );
        if (document.hasFocus() && openChat?.account === id && openChat.chat === m.chatId) continue;
        const sender = m.senderName || `+${m.chatId.split("@")[0]}`;
        const title = accounts.length > 1 && account ? `${sender} · ${account.name}` : sender;
        void notifyText(title, m.body || (m.kind === "media" ? "📎 Media" : "New message"));
      }
    });
    const accounts = sortAccounts(await nativeWa.accounts());
    let active = (await (await store()).get<string | null>("active")) ?? null;
    if (active && !accounts.some((a) => a.id === active)) active = null;
    set({ accounts, active, hydrated: true });
  },
  async add(name) {
    const account = await nativeWa.add(nativeWa.newId(), name ?? `WhatsApp ${get().accounts.length + 1}`);
    set((st) => ({ accounts: upsert(st.accounts, account) }));
    get().setActive(account.id);
    await nativeWa.start(account.id);
    return account;
  },
  async rename(id, name) {
    await nativeWa.rename(id, name);
  },
  async remove(id) {
    await nativeWa.remove(id);
    set((st) => {
      const accounts = st.accounts.filter((a) => a.id !== id);
      const { [id]: _, ...qr } = st.qr;
      return { accounts, qr };
    });
    if (get().active === id) get().setActive(get().accounts[0]?.id ?? null);
  },
  setActive(id) {
    set({ active: id });
    void store().then((s) => s.set("active", id));
  },
  setOpenChat(openChat) {
    set({ openChat });
  },
}));

/** Unread chats across every native account. */
export const totalWhatsAppUnread = (accounts: NativeAccount[]) => accounts.reduce((sum, a) => sum + a.unread, 0);
