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
  /** Delivery state of my newest message (see `NativeMessage.ack`). */
  lastAck: number;
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
  /** Delivery state of a message I sent: 0 pending, 1 sent, 2 delivered, 3 read, 4 played. */
  ack: number;
  /** When it was deleted for everyone (unix ms); its content is kept to show what it was. */
  revokedAt: number | null;
  /** When it was last edited (unix ms). */
  editedAt: number | null;
  /** Earlier texts of an edited message, oldest first. */
  edits: NativeEdit[];
  /** Reaction totals on a channel message (the server reports counts, not who reacted). */
  channelReactions: { emoji: string; count: number }[];
  /** The message this one replies to. */
  replyTo: NativeReply | null;
  /** Shared by the photos and videos that were sent together as one album. */
  albumId: string | null;
  /** The link preview WhatsApp embedded in the message, when it has one. */
  preview: NativeLinkPreview | null;
}

/** A link preview WhatsApp fetched and embedded in the message. */
export interface NativeLinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  /** The thumbnail as a data URL. */
  image: string | null;
}

/** A quoted message as shown above a reply. */
export interface NativeReply {
  id: string;
  fromMe: boolean;
  senderName: string;
  text: string;
}

/** When one recipient got, read and played a message of mine (unix ms; null = not seen). */
export interface NativeReceipt {
  id: string;
  name: string;
  deliveredAt: number | null;
  readAt: number | null;
  playedAt: number | null;
}

/** One earlier text of an edited message. */
export interface NativeEdit {
  body: string;
  /** When this text was replaced (unix ms). */
  replacedAt: number;
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

/** An incoming reaction to a message. */
export interface NativeReaction {
  id: string;
  messageId: string;
  from: string;
  fromMe: boolean;
  participant: string | null;
  text: string;
}

/** A message deleted for everyone. */
export interface NativeRevoked {
  id: string;
  chatId: string;
  messageId: string;
  fromMe: boolean;
  participant: string | null;
  timestamp: number;
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

/** A message pinned or unpinned for everyone. `expires` is unix ms (0 when unpinned). */
export interface NativePin {
  id: string;
  chatId: string;
  messageId: string;
  on: boolean;
  expires: number;
}

/** A chat label (WhatsApp "etiqueta"). `color` is a WhatsApp color index. */
export interface NativeLabel {
  id: string;
  name: string;
  color: number;
}

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

export interface NativeChannelDetails {
  type: "channel";
  id: string;
  name: string;
  description: string | null;
  /** Null when the server would not give the details (see `warning`). */
  subscribers: number | null;
  verified: boolean;
  /** Why the details are partial, with the underlying error. */
  warning: string | null;
  inviteLink: string | null;
  /** The viewer's role: "owner", "admin", "subscriber" or "guest". */
  role: string | null;
  /** Unix milliseconds. */
  createdAt: number | null;
  picture: string | null;
}

export type NativeChatDetails = NativeContactDetails | NativeGroupDetails | NativeChannelDetails;

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
  sendText: (id: string, chatId: string, text: string, quoteId?: string | null) =>
    invoke<void>("wa_native_send_text", { id, chatId, text, quoteId: quoteId ?? null }),
  /** React to a message; an empty `emoji` removes your reaction. */
  react: (id: string, chatId: string, messageId: string, emoji: string) =>
    invoke<void>("wa_native_react", { id, chatId, messageId, emoji }),
  /** Edit one of your own messages. */
  edit: (id: string, chatId: string, messageId: string, text: string) => invoke<void>("wa_native_edit", { id, chatId, messageId, text }),
  /** Remove a message from this device only. */
  deleteLocal: (id: string, chatId: string, messageId: string) => invoke<void>("wa_native_delete_local", { id, chatId, messageId }),
  /** Delete a message for everyone: your own, or (as a group admin) someone else's. */
  deleteMessage: (id: string, chatId: string, messageId: string) => invoke<void>("wa_native_delete", { id, chatId, messageId }),
  /** Pin a message for everyone (7 days) or unpin it. */
  pinMessage: (id: string, chatId: string, messageId: string, on: boolean) =>
    invoke<void>("wa_native_pin_message", { id, chatId, messageId, on }),
  /** Forward a stored message to another chat. */
  forward: (id: string, fromChatId: string, messageId: string, toChatId: string) =>
    invoke<void>("wa_native_forward", { id, fromChatId, messageId, toChatId }),
  chats: (id: string) => invoke<NativeChat[]>("wa_native_chats", { id }),
  /** The newest `limit` stored messages of a chat, oldest first. */
  messages: (id: string, chatId: string, limit: number) => invoke<NativeMessage[]>("wa_native_messages", { id, chatId, limit }),
  /** Ask the phone for older messages; they arrive later as a chats update. */
  loadOlder: (id: string, chatId: string) => invoke<void>("wa_native_load_older", { id, chatId }),
  /** Fetch a channel's latest page, or with `older` the page before the oldest stored; resolves to how many came back. */
  /** Follow a channel from its invite link or code; resolves to its chat id. */
  channelFollow: (id: string, invite: string) => invoke<string>("wa_native_channel_follow", { id, invite }),
  channelLeave: (id: string, chatId: string) => invoke<void>("wa_native_channel_leave", { id, chatId }),
  /** Rename a channel or change its description (owners and admins). */
  channelUpdate: (id: string, chatId: string, name: string | null, description: string | null) =>
    invoke<void>("wa_native_channel_update", { id, chatId, name, description }),
  channelMute: (id: string, chatId: string, muted: boolean) => invoke<void>("wa_native_channel_mute", { id, chatId, muted }),
  channelSync: (id: string, chatId: string, older: boolean) => invoke<number>("wa_native_channel_sync", { id, chatId, older }),
  markRead: (id: string, chatId: string) => invoke<void>("wa_native_mark_read", { id, chatId }),
  /** Per-recipient delivery, read and played times for a message I sent. */
  messageInfo: (id: string, messageId: string) => invoke<NativeReceipt[]>("wa_native_message_info", { id, messageId }),
  /** Clear unread on every chat, or only on `chatIds`. */
  markAllRead: (id: string, chatIds?: string[]) => invoke<void>("wa_native_mark_all_read", { id, chatIds: chatIds ?? null }),
  /** Delete chats from this device and the linked phone. */
  deleteChats: (id: string, chatIds: string[]) => invoke<void>("wa_native_delete_chats", { id, chatIds }),
  /** Send read receipts (blue ticks) for the chat's newest incoming messages. */
  sendReceipt: (id: string, chatId: string) => invoke<void>("wa_native_send_receipt", { id, chatId }),
  /** Tell the other side you are (or stopped) typing. */
  setTyping: (id: string, chatId: string, on: boolean) => invoke<void>("wa_native_set_typing", { id, chatId, on }),
  /** Listen for the other side typing in the open chat (goes online and subscribes to their presence). */
  watchTyping: (id: string, chatId: string, on: boolean) => invoke<void>("wa_native_watch_typing", { id, chatId, on }),
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
  /** Chat labels cached from app-state sync. */
  labels: (id: string) => invoke<NativeLabel[]>("wa_native_labels", { id }),
  /** Ids of the labels on one chat. */
  chatLabels: (id: string, chatId: string) => invoke<string[]>("wa_native_chat_labels", { id, chatId }),
  /** Every chat's label ids, for the chips in the chat list. */
  labelMap: (id: string) => invoke<Record<string, string[]>>("wa_native_label_map", { id }),
  /** Create (or rename) a label; returns its id. */
  labelCreate: (id: string, name: string, color: number, labelId?: string) =>
    invoke<string>("wa_native_label_create", { id, labelId, name, color }),
  labelDelete: (id: string, labelId: string) => invoke<void>("wa_native_label_delete", { id, labelId }),
  labelLink: (id: string, labelId: string, chatId: string, on: boolean) =>
    invoke<void>("wa_native_label_link", { id, labelId, chatId, on }),
  /** Pin or unpin a chat (syncs to the phone). */
  pinChat: (id: string, chatId: string, on: boolean) => invoke<void>("wa_native_pin_chat", { id, chatId, on }),
  /** The newest messages with an attachment, oldest first. */
  chatMedia: (id: string, chatId: string) => invoke<NativeMessage[]>("wa_native_chat_media", { id, chatId }),
  /** Download and decrypt a message's attachment. */
  media: (id: string, chatId: string, messageId: string) => invoke<ArrayBuffer>("wa_native_media", { id, chatId, messageId }),
  /** Send a file (with an optional caption) as photo, video, audio or document by its type, optionally quoting a message. */
  sendMedia: (id: string, chatId: string, file: Blob, name: string, caption: string, quoteId?: string | null) =>
    file.arrayBuffer().then((buf) =>
      invoke<NativeMessage>("wa_native_send_media", new Uint8Array(buf), {
        headers: {
          "x-account": id,
          "x-chat": encodeURIComponent(chatId),
          "x-mime": file.type || "application/octet-stream",
          "x-name": encodeURIComponent(name),
          "x-caption": encodeURIComponent(caption),
          "x-quote": encodeURIComponent(quoteId ?? ""),
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

/** An account's labels changed (create/rename/delete/assign). */
export const onNativeLabels = (cb: (id: string) => void): Promise<UnlistenFn> =>
  listen<{ id: string }>("wa_native:labels", (event) => cb(event.payload.id));

/** A status (story) arrived for an account. */
export const onNativeStatus = (cb: (id: string) => void): Promise<UnlistenFn> =>
  listen<{ id: string }>("wa_native:status", (event) => cb(event.payload.id));

/** Someone reacted to (or un-reacted from) a message. */
export const onNativeReaction = (cb: (reaction: NativeReaction) => void): Promise<UnlistenFn> =>
  listen<NativeReaction>("wa_native:reaction", (event) => cb(event.payload));

/** A message was deleted for everyone. */
export const onNativeRevoked = (cb: (revoked: NativeRevoked) => void): Promise<UnlistenFn> =>
  listen<NativeRevoked>("wa_native:revoked", (event) => cb(event.payload));

/** A message was pinned or unpinned for everyone (from any device). */
export const onNativePin = (cb: (pin: NativePin) => void): Promise<UnlistenFn> =>
  listen<NativePin>("wa_native:pin", (event) => cb(event.payload));

/** Someone typing, recording or pausing in a chat. `chatIds` lists the chat under both its phone and privacy id. */
export interface NativeTyping {
  id: string;
  chatIds: string[];
  sender: string;
  senderName: string | null;
  state: "typing" | "recording" | "paused";
}

export const onNativeTyping = (cb: (typing: NativeTyping) => void): Promise<UnlistenFn> =>
  listen<NativeTyping>("wa_native:typing", (event) => cb(event.payload));
