import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function formatDateDivider(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

/** Display-friendly name for a WhatsApp chat id (strip @c.us / @g.us / @lid). */
export function displayId(id: string | null | undefined) {
  if (!id) return "";
  const base = id.split("@")[0]!;
  if (id.endsWith("@c.us")) return "+" + base;
  if (id.endsWith("@newsletter")) return "Channel " + base.slice(-6);
  return base;
}

export function isGroup(id: string | null | undefined) {
  return !!id && id.endsWith("@g.us");
}

export function isChannel(id: string | null | undefined) {
  return !!id && id.endsWith("@newsletter");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]!);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * Resolve the chat a message belongs to. WAHA/GOWS may report LID ids
 * (`@lid`) while the chat list uses phone ids (`@c.us`); prefer the phone form.
 */
export function messageChatId(m: {
  from: string;
  to: string;
  fromMe: boolean;
  chatId?: string;
  _data?: unknown;
}): string {
  if (m.chatId) return m.chatId;
  const info = (m._data as { Info?: { Chat?: string; SenderAlt?: string; RecipientAlt?: string } } | undefined)?.Info;
  let chat = info?.Chat || (m.fromMe ? m.to : m.from);
  if (chat?.endsWith("@lid")) {
    const alt = m.fromMe ? info?.RecipientAlt : info?.SenderAlt;
    if (alt) chat = alt.replace(/@s\.whatsapp\.net$/, "@c.us");
  }
  return chat;
}
