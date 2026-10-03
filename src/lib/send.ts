import { accountId } from "@/lib/account";
import { nativeWa } from "@/lib/nativeWa";

/** Sends on behalf of an account key (`native:<accountId>`), for the scheduler, broadcasts and auto-reply. */

/** A file to send, base64 as stored in schedules and broadcasts. */
export interface MediaPayload {
  mimetype: string;
  name: string;
  base64: string;
}

export interface SendOutcome {
  id?: string;
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const nativeIdOf = (account: string) => {
  const id = accountId(account);
  if (!id) throw new Error(`not a WhatsApp account: ${account}`);
  return id;
};

/** `…@c.us` ids (typed numbers, jobs from older versions) are the legacy server form of `…@s.whatsapp.net`. */
const nativeChat = (chatId: string) => chatId.replace(/@c\.us$/, "@s.whatsapp.net");

/** Send one text message from an account. */
export async function sendTextOn(account: string, chatId: string, text: string, replyTo?: string): Promise<SendOutcome> {
  const id = nativeIdOf(account);
  const chat = nativeChat(chatId);
  // A quote needs the message in the local store; send unquoted rather than not at all.
  if (replyTo)
    await nativeWa.sendText(id, chat, text, replyTo).catch((e) => {
      if (!/quoted/i.test(String(e))) throw e;
      return nativeWa.sendText(id, chat, text);
    });
  else await nativeWa.sendText(id, chat, text);
  return {};
}

/** Send one media message (photo/video/document by mimetype) from an account. */
export async function sendMediaOn(account: string, chatId: string, file: MediaPayload, caption: string): Promise<SendOutcome> {
  const blob = new Blob([b64ToBytes(file.base64)], { type: file.mimetype || "application/octet-stream" });
  const msg = await nativeWa.sendMedia(nativeIdOf(account), nativeChat(chatId), blob, file.name, caption);
  return { id: msg?.id };
}

/** Post one text status from an account. */
export async function postStatusTextOn(account: string, text: string): Promise<void> {
  await nativeWa.postStatusText(nativeIdOf(account), text, 0xff128c7e);
}

/** Post one photo/video status from an account. */
export async function postStatusMediaOn(account: string, file: MediaPayload, caption: string): Promise<void> {
  const blob = new Blob([b64ToBytes(file.base64)], { type: file.mimetype || "application/octet-stream" });
  await nativeWa.postStatusMedia(nativeIdOf(account), blob, caption);
}

/** Mark a chat seen. */
export async function markSeenOn(account: string, chatId: string): Promise<void> {
  await nativeWa.sendReceipt(nativeIdOf(account), nativeChat(chatId));
}

/** Show (or stop) "typing…" in a chat. */
export async function setTypingOn(account: string, chatId: string, on: boolean): Promise<void> {
  await nativeWa.setTyping(nativeIdOf(account), nativeChat(chatId), on);
}
