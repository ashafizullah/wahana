import type { NativeChatDetails, NativeGroupMember } from "@/lib/nativeWa";
import type { MentionResolver } from "@/lib/waMarkdown";

/** A member picked from the mention popover: the label typed in the draft and their jid. */
export interface PickedMention {
  label: string;
  jid: string;
}

/** The digits of an id ("62812:12@s.whatsapp.net", "+62812") used to key and look up mentions. */
export const mentionDigits = (id: string) => id.split(/[:@]/)[0]!.replace(/\D/g, "");

/** How a member is named: their name, else their number, else the id's user part. */
export function memberLabel(member: NativeGroupMember): string {
  return member.name || member.phone || member.id.split("@")[0]!;
}

/**
 * Turns a draft into the wire form: every picked mention still present as `@Label`
 * becomes `@<jid user part>`, and each jid that appears is collected once. Labels are
 * matched longest first, so "Adam Suchi" is not partially eaten by "Adam".
 */
export function applyMentions(text: string, picked: PickedMention[]): { text: string; mentions: string[] } {
  let out = text;
  const mentions: string[] = [];
  const ordered = [...picked].sort((a, b) => b.label.length - a.label.length);
  for (const { label, jid } of ordered) {
    const token = `@${label}`;
    if (!out.includes(token)) continue;
    out = out.split(token).join(`@${jid.split("@")[0]}`);
    if (!mentions.includes(jid)) mentions.push(jid);
  }
  return { text: out, mentions };
}

/** Resolves group mention digits to names; the account's own member reads back as "You". */
export function mentionResolver(details: NativeChatDetails | undefined, meId?: string): MentionResolver {
  const names = new Map<string, string>();
  if (details?.type === "group") {
    for (const m of details.members) {
      const name = m.isMe ? "You" : memberLabel(m);
      names.set(mentionDigits(m.id), name);
      if (m.phone) names.set(mentionDigits(m.phone), name);
    }
  }
  const me = meId ? mentionDigits(meId) : "";
  return (id) => {
    if (!id) return undefined;
    const digits = mentionDigits(id);
    if (me && digits === me) return "You";
    return names.get(digits);
  };
}
