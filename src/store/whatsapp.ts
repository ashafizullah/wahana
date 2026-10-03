import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  nativeWa,
  onNativeAccount,
  onNativeChats,
  onNativeLabels,
  onNativeMessages,
  onNativePin,
  onNativeQr,
  onNativeReaction,
  onNativeRevoked,
  type NativeAccount,
  type NativeQr,
} from "@/lib/nativeWa";
import { nativeAccountKey, nativeChatKey } from "@/lib/account";
import { convKey } from "@/lib/utils";
import { isMutedUntil, useChatPrefs } from "@/store/chatPrefs";
import { usePins } from "@/store/pins";
import { useReactions } from "@/store/reactions";
import { useRevoked } from "@/store/revoked";
import { notifyText } from "@/realtime/notify";
import { useSettings } from "@/store/settings";

/**
 * Native WhatsApp accounts (no server needed), driven by the Rust client. `active` is the
 * account the chat screen shows. The account list itself is owned and persisted by the
 * backend; only the picker's choice is kept here.
 */

/** Detail of the `wahana:incoming` event: a message just arrived in a native account. */
export interface IncomingMessage {
  account: string;
  chatId: string;
  message: {
    id: string;
    /** unix seconds */
    timestamp: number;
    fromMe: boolean;
    /** The sender's chat id (`…@s.whatsapp.net` / `…@lid`). */
    from: string;
    body: string;
    hasMedia: boolean;
    /** The sender's own profile name, when known. */
    senderName?: string;
  };
}

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
  /** Bumped whenever an account's labels change (created, renamed, assigned). */
  labelsTick: number;
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
  labelsTick: 0,
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
    await onNativeLabels(() => set((st) => ({ labelsTick: st.labelsTick + 1 })));
    await onNativeReaction((r) =>
      useReactions.getState().apply({
        id: r.messageId,
        from: r.from,
        fromMe: r.fromMe,
        participant: r.participant,
        reaction: { text: r.text, messageId: r.messageId },
      }),
    );
    await onNativePin((p) => usePins.getState().set(convKey(p.id, p.chatId), p.messageId, p.on ? p.expires : 0));
    await onNativeRevoked((r) =>
      useRevoked.getState().add({
        id: r.messageId,
        chat: convKey(r.id, r.chatId),
        timestamp: Math.floor(r.timestamp / 1000),
        fromMe: r.fromMe,
        participant: r.participant,
        from: r.fromMe ? null : r.chatId,
      }),
    );
    await onNativeMessages(({ id, messages }) => {
      set((st) => ({ messageTick: st.messageTick + 1 }));
      const { accounts, openChat } = get();
      const account = accounts.find((a) => a.id === id);
      for (const m of messages) {
        if (m.fromMe) continue;
        // Feed the auto-reply and auto-label runners.
        window.dispatchEvent(
          new CustomEvent<IncomingMessage>("wahana:incoming", {
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
                senderName: m.senderName || undefined,
              },
            },
          }),
        );
        if (!useSettings.getState().notifications) continue;
        if (document.hasFocus() && openChat?.account === id && openChat.chat === m.chatId) continue;
        if (isMutedUntil(useChatPrefs.getState().muted[nativeChatKey(id, m.chatId)])) continue;
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
    // Reflect it immediately; the account event that follows is idempotent.
    set((st) => ({ accounts: st.accounts.map((a) => (a.id === id ? { ...a, name } : a)) }));
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
