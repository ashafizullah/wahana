import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Thin client for the native WhatsApp accounts served by `src-tauri/src/whatsapp.rs`:
 * pairing, status, send text, and whatever chats and messages the running client has seen
 * since launch. App state built on it lives in `@/store/whatsapp`.
 */

export type NativeWaStatus = "stopped" | "starting" | "qr" | "working" | "logged_out" | "failed";

export interface NativeAccount {
  id: string;
  name: string;
  status: NativeWaStatus;
  me: { id: string; pushName: string } | null;
  error: string | null;
  /** Chats with unread messages. */
  unread: number;
  /** Percent of the history transfer from the phone, while one is running. */
  syncing: number | null;
}

export interface NativeChat {
  id: string;
  name: string;
  lastText: string;
  lastTimestamp: number;
  lastFromMe: boolean;
  lastSender: string;
  unread: number;
  /** "+62…" for a direct chat whose number is known. */
  phone: string | null;
  /** Named from your contacts (or a group); otherwise `name` is the other side's own push name. */
  saved: boolean;
}

export interface NativeMedia {
  kind: "image" | "video" | "audio" | "ptt" | "document" | "sticker";
  mimetype: string;
  fileName: string | null;
  size: number | null;
  seconds: number | null;
  width: number | null;
  height: number | null;
  /** Blurry inline preview as a data URL. */
  thumbnail: string | null;
}

export interface NativeMessage {
  id: string;
  chatId: string;
  fromMe: boolean;
  senderName: string;
  senderPhone: string | null;
  kind: "text" | "media" | "unsupported";
  /** The text, or a media message's caption. */
  body: string;
  timestamp: number;
  media: NativeMedia | null;
}

export interface NativeQr {
  id: string;
  code: string;
  timeoutMs: number;
}

export interface NativeMessageBatch {
  id: string;
  messages: NativeMessage[];
}

export interface NativeContactDetails {
  type: "contact";
  id: string;
  name: string | null;
  saved: boolean;
  phone: string | null;
  /** Their "About" text, unless their privacy settings hide it. */
  about: string | null;
  business: boolean;
  verifiedName: string | null;
  /** Full-size profile picture URL. */
  picture: string | null;
}

/** A status (story): the message plus the poster's bare id (empty for your own). */
export type NativeStatus = NativeMessage & { sender: string };

export interface NativeGroupMember {
  id: string;
  name: string | null;
  saved: boolean;
  phone: string | null;
  admin: boolean;
  superAdmin: boolean;
  isMe: boolean;
}

export interface NativeGroupDetails {
  type: "group";
  id: string;
  subject: string;
  description: string | null;
  /** Unix milliseconds. */
  createdAt: number | null;
  creator: NativeGroupMember | null;
  /** Only admins can send messages. */
  announce: boolean;
  /** Only admins can edit the group info. */
  locked: boolean;
  /** New members need an admin's approval. */
  approval: boolean;
  members: NativeGroupMember[];
  picture: string | null;
}

export type NativeChatDetails = NativeContactDetails | NativeGroupDetails;

/** A change to a group; member ids are as listed in `NativeGroupDetails.members`. */
export type NativeGroupAction =
  | { type: "setSubject"; subject: string }
  | { type: "setDescription"; description: string }
  | { type: "setAnnounce"; on: boolean }
  | { type: "setLocked"; on: boolean }
  | { type: "setApproval"; on: boolean }
  /** JPEG bytes, base64. */
  | { type: "setPicture"; jpeg: string }
  | { type: "removePicture" }
  | { type: "add"; phones: string[] }
  | { type: "remove"; members: string[] }
  | { type: "promote"; members: string[] }
  | { type: "demote"; members: string[] }
  | { type: "approve"; members: string[] }
  | { type: "reject"; members: string[] }
  | { type: "inviteLink"; reset: boolean }
  | { type: "leave" };

export interface NativeGroupActionResult {
  inviteLink: string | null;
  /** People the change did not apply to, with the reason. */
  failed: string[];
}

export interface NativeJoinRequest {
  id: string;
  name: string | null;
  /** Whether `name` is from your contacts. */
  saved: boolean;
  phone: string | null;
  /** Unix milliseconds. */
  requestedAt: number | null;
}

export const nativeWa = {
  accounts: () => invoke<NativeAccount[]>("wa_native_accounts"),
  add: (id: string, name: string) => invoke<NativeAccount>("wa_native_add", { id, name }),
  start: (id: string) => invoke<void>("wa_native_start", { id }),
  stop: (id: string) => invoke<void>("wa_native_stop", { id }),
  logout: (id: string) => invoke<void>("wa_native_logout", { id }),
  rename: (id: string, name: string) => invoke<void>("wa_native_rename", { id, name }),
  picture: (id: string, chatId: string) => invoke<string | null>("wa_native_picture", { id, chatId }),
  remove: (id: string) => invoke<void>("wa_native_remove", { id }),
  sendText: (id: string, chatId: string, text: string) => invoke<void>("wa_native_send_text", { id, chatId, text }),
  chats: (id: string) => invoke<NativeChat[]>("wa_native_chats", { id }),
  /** The newest `limit` stored messages of a chat, oldest first. */
  messages: (id: string, chatId: string, limit: number) => invoke<NativeMessage[]>("wa_native_messages", { id, chatId, limit }),
  /** Ask the phone for older messages; they arrive later as a chats update. */
  loadOlder: (id: string, chatId: string) => invoke<void>("wa_native_load_older", { id, chatId }),
  markRead: (id: string, chatId: string) => invoke<void>("wa_native_mark_read", { id, chatId }),
  /** Send read receipts (blue ticks) for the chat's newest incoming messages. */
  sendReceipt: (id: string, chatId: string) => invoke<void>("wa_native_send_receipt", { id, chatId }),
  /** Tell the other side you are (or stopped) typing. */
  setTyping: (id: string, chatId: string, on: boolean) => invoke<void>("wa_native_set_typing", { id, chatId, on }),
  /** Contact profile or group details and members, fetched live. */
  chatInfo: (id: string, chatId: string) => invoke<NativeChatDetails>("wa_native_chat_info", { id, chatId }),
  groupAction: (id: string, chatId: string, action: NativeGroupAction) =>
    invoke<NativeGroupActionResult>("wa_native_group_action", { id, chatId, action }),
  groupRequests: (id: string, chatId: string) => invoke<NativeJoinRequest[]>("wa_native_group_requests", { id, chatId }),
  /** The newest statuses (stories), newest first. */
  statuses: (id: string) => invoke<NativeStatus[]>("wa_native_statuses", { id }),
  /** Tell the poster their status was viewed. */
  statusViewed: (id: string, sender: string, messageId: string) => invoke<void>("wa_native_status_viewed", { id, sender, messageId }),
  /** Post a text status (background is 0xAARRGGBB) to every saved contact. */
  postStatusText: (id: string, text: string, backgroundArgb: number) =>
    invoke<void>("wa_native_post_status_text", { id, text, backgroundArgb }),
  /** Post a photo/video status; `thumbnail` is a base64 JPEG. */
  postStatusMedia: (id: string, file: Blob, caption: string, thumbnail?: string) =>
    file.arrayBuffer().then((buf) =>
      invoke<void>("wa_native_post_status_media", new Uint8Array(buf), {
        headers: {
          "x-account": id,
          "x-mime": file.type || "application/octet-stream",
          "x-caption": encodeURIComponent(caption),
          ...(thumbnail ? { "x-thumb": thumbnail } : {}),
        },
      }),
    ),
  deleteStatus: (id: string, messageId: string) => invoke<void>("wa_native_delete_status", { id, messageId }),
  /** The newest messages with an attachment, oldest first. */
  chatMedia: (id: string, chatId: string) => invoke<NativeMessage[]>("wa_native_chat_media", { id, chatId }),
  /** Download and decrypt a message's attachment. */
  media: (id: string, chatId: string, messageId: string) => invoke<ArrayBuffer>("wa_native_media", { id, chatId, messageId }),
  /** Send a file (with an optional caption) as photo, video, audio or document by its type. */
  sendMedia: (id: string, chatId: string, file: Blob, name: string, caption: string) =>
    file.arrayBuffer().then((buf) =>
      invoke<NativeMessage>("wa_native_send_media", new Uint8Array(buf), {
        headers: {
          "x-account": id,
          "x-chat": encodeURIComponent(chatId),
          "x-mime": file.type || "application/octet-stream",
          "x-name": encodeURIComponent(name),
          "x-caption": encodeURIComponent(caption),
        },
      }),
    ),
  /** Account ids name a database file, so the backend requires a 32-hex id. */
  newId: () => crypto.randomUUID().replace(/-/g, ""),
};

export const onNativeAccount = (cb: (account: NativeAccount) => void): Promise<UnlistenFn> =>
  listen<NativeAccount>("wa_native:account", (event) => cb(event.payload));

export const onNativeQr = (cb: (qr: NativeQr) => void): Promise<UnlistenFn> =>
  listen<NativeQr>("wa_native:qr", (event) => cb(event.payload));

/** The chat list changed without a new message (e.g. group names arrived). */
export const onNativeChats = (cb: (id: string) => void): Promise<UnlistenFn> =>
  listen<{ id: string }>("wa_native:chats", (event) => cb(event.payload.id));

export const onNativeMessages = (cb: (batch: NativeMessageBatch) => void): Promise<UnlistenFn> =>
  listen<NativeMessageBatch>("wa_native:messages", (event) => cb(event.payload));

/** A status (story) arrived for an account. */
export const onNativeStatus = (cb: (id: string) => void): Promise<UnlistenFn> =>
  listen<{ id: string }>("wa_native:status", (event) => cb(event.payload.id));
