import { accountParts } from "@/lib/account";
import { nativeWa } from "@/lib/nativeWa";
import { requireClient } from "@/store/settings";

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

const sessionOf = (account: string) => {
  const p = accountParts(account);
  if (p?.kind !== "waha" || p.session === undefined) throw new Error(`not a WAHA account: ${account}`);
  return p.session;
};

const nativeIdOf = (account: string) => {
  const p = accountParts(account);
  if (p?.kind !== "native" || !p.id) throw new Error(`not a native account: ${account}`);
  return p.id;
};

/** Send one text message from an account. */
export async function sendTextOn(account: string, chatId: string, text: string, replyTo?: string): Promise<SendOutcome> {
  if (accountParts(account)?.kind === "native") {
    await nativeWa.sendText(nativeIdOf(account), chatId, text);
    return {};
  }
  const msg = await requireClient().sendText(sessionOf(account), chatId, text, replyTo);
  return { id: (msg as { id?: string } | undefined)?.id };
}

/** Send one media message (photo/video/document by mimetype) from an account. */
export async function sendMediaOn(account: string, chatId: string, file: MediaPayload, caption: string): Promise<SendOutcome> {
  if (accountParts(account)?.kind === "native") {
    const blob = new Blob([b64ToBytes(file.base64)], { type: file.mimetype || "application/octet-stream" });
    const msg = await nativeWa.sendMedia(nativeIdOf(account), chatId, blob, file.name, caption);
    return { id: msg?.id };
  }
  const c = requireClient();
  const f = { mimetype: file.mimetype, filename: file.name, data: file.base64 };
  const session = sessionOf(account);
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
  await requireClient().postTextStatus(sessionOf(account), text);
}

/** Post one photo/video status from an account. */
export async function postStatusMediaOn(account: string, file: MediaPayload, caption: string): Promise<void> {
  if (accountParts(account)?.kind === "native") {
    const blob = new Blob([b64ToBytes(file.base64)], { type: file.mimetype || "application/octet-stream" });
    await nativeWa.postStatusMedia(nativeIdOf(account), blob, caption);
    return;
  }
  const c = requireClient();
  const f = { mimetype: file.mimetype, filename: file.name, data: file.base64 };
  if (file.mimetype.startsWith("video/")) await c.postVideoStatus(sessionOf(account), f, caption || undefined);
  else await c.postImageStatus(sessionOf(account), f, caption || undefined);
}

/** Mark a chat (or one message) seen, on whichever account. */
export async function markSeenOn(account: string, chatId: string, messageId?: string): Promise<void> {
  if (accountParts(account)?.kind === "native") {
    await nativeWa.sendReceipt(nativeIdOf(account), chatId);
    return;
  }
  await requireClient().sendSeen(sessionOf(account), chatId, messageId ? [messageId] : undefined);
}
