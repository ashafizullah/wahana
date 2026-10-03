import { accountParts } from "@/lib/account";
import { nativeWa } from "@/lib/nativeWa";
import { clientForProfile } from "@/store/settings";

/**
 * Routes a send to whichever kind of account owns the key (`waha:<profile>:<session>` /
 * `native:<accountId>`), so the scheduler, broadcasts and auto-reply work for both.
 */

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

const wahaOf = async (account: string) => {
  const p = accountParts(account);
  if (p?.kind !== "waha" || p.session === undefined) throw new Error(`not a WAHA account: ${account}`);
  return { c: await clientForProfile(p.profile), session: p.session };
};

const nativeIdOf = (account: string) => {
  const p = accountParts(account);
  if (p?.kind !== "native" || !p.id) throw new Error(`not a native account: ${account}`);
  return p.id;
};

/** WAHA-style `…@c.us` ids (typed numbers, old jobs) are a legacy server to the native client. */
const nativeChat = (chatId: string) => chatId.replace(/@c\.us$/, "@s.whatsapp.net");

/** Send one text message from an account. */
export async function sendTextOn(account: string, chatId: string, text: string, replyTo?: string): Promise<SendOutcome> {
  if (accountParts(account)?.kind === "native") {
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
  const { c, session } = await wahaOf(account);
  const msg = await c.sendText(session, chatId, text, replyTo);
  return { id: (msg as { id?: string } | undefined)?.id };
}

/** Send one media message (photo/video/document by mimetype) from an account. */
export async function sendMediaOn(account: string, chatId: string, file: MediaPayload, caption: string): Promise<SendOutcome> {
  if (accountParts(account)?.kind === "native") {
    const blob = new Blob([b64ToBytes(file.base64)], { type: file.mimetype || "application/octet-stream" });
    const msg = await nativeWa.sendMedia(nativeIdOf(account), nativeChat(chatId), blob, file.name, caption);
    return { id: msg?.id };
  }
  const { c, session } = await wahaOf(account);
  const f = { mimetype: file.mimetype, filename: file.name, data: file.base64 };
  const msg = file.mimetype.startsWith("image/")
    ? await c.sendImage(session, chatId, f, caption || undefined)
    : file.mimetype.startsWith("video/")
      ? await c.sendVideo(session, chatId, f, caption || undefined)
      : await c.sendFile(session, chatId, f, caption || undefined);
  return { id: (msg as { id?: string } | undefined)?.id };
}

/** Post one text status from an account. */
export async function postStatusTextOn(account: string, text: string): Promise<void> {
  if (accountParts(account)?.kind === "native") {
    await nativeWa.postStatusText(nativeIdOf(account), text, 0xff128c7e);
    return;
  }
  const { c, session } = await wahaOf(account);
  await c.postTextStatus(session, text);
}

/** Post one photo/video status from an account. */
export async function postStatusMediaOn(account: string, file: MediaPayload, caption: string): Promise<void> {
  if (accountParts(account)?.kind === "native") {
    const blob = new Blob([b64ToBytes(file.base64)], { type: file.mimetype || "application/octet-stream" });
    await nativeWa.postStatusMedia(nativeIdOf(account), blob, caption);
    return;
  }
  const { c, session } = await wahaOf(account);
  const f = { mimetype: file.mimetype, filename: file.name, data: file.base64 };
  if (file.mimetype.startsWith("video/")) await c.postVideoStatus(session, f, caption || undefined);
  else await c.postImageStatus(session, f, caption || undefined);
}

/** Mark a chat (or one message) seen, on whichever account. */
export async function markSeenOn(account: string, chatId: string, messageId?: string): Promise<void> {
  if (accountParts(account)?.kind === "native") {
    await nativeWa.sendReceipt(nativeIdOf(account), nativeChat(chatId));
    return;
  }
  const { c, session } = await wahaOf(account);
  await c.sendSeen(session, chatId, messageId ? [messageId] : undefined);
}

/** Show (or stop) "typing…" in a chat, on whichever account. */
export async function setTypingOn(account: string, chatId: string, on: boolean): Promise<void> {
  if (accountParts(account)?.kind === "native") {
    await nativeWa.setTyping(nativeIdOf(account), nativeChat(chatId), on);
    return;
  }
  const { c, session } = await wahaOf(account);
  await (on ? c.startTyping(session, chatId) : c.stopTyping(session, chatId));
}
