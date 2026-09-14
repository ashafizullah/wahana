import { describe, expect, it } from "vitest";
import { replaceMentions, stripWaMarkdown } from "@/lib/waMarkdown";
import { displayId, initials, messageChatId } from "@/lib/utils";
import { expandTemplate } from "@/store/quickReplies";
import { embeddedPreview, firstUrl, isWebUrl } from "@/components/LinkPreview";
import type { WAMessage } from "@/api/types";

describe("stripWaMarkdown", () => {
  it("removes WhatsApp markers and list prefixes", () => {
    expect(stripWaMarkdown("*bold* _it_ ~s~ `c`")).toBe("bold it s c");
    expect(stripWaMarkdown("- a\n1. b\n> c")).toBe("a b c");
    expect(stripWaMarkdown("```code\nblock```")).toBe("code block");
  });
  it("keeps lone asterisks (2 * 3)", () => {
    expect(stripWaMarkdown("2 * 3 * 4")).toBe("2 * 3 * 4");
  });
});

describe("replaceMentions", () => {
  it("resolves digit mentions, leaves unknown ones", () => {
    const resolve = (id: string | null | undefined) => (id === "628123456" ? "Adam" : undefined);
    expect(replaceMentions("hi @628123456 and @1234567", resolve)).toBe("hi @Adam and @1234567");
    expect(replaceMentions("mail@628123456.com", resolve)).toBe("mail@628123456.com");
  });
});

describe("utils", () => {
  it("displayId", () => {
    expect(displayId("62812@c.us")).toBe("+62812");
    expect(displayId("123@g.us")).toBe("123");
    expect(displayId("120363123456@newsletter")).toBe("Channel 123456");
    expect(displayId(null)).toBe("");
  });
  it("initials", () => {
    expect(initials("adam suchi hafizullah")).toBe("AS");
  });
  it("messageChatId prefers phone ids over LIDs", () => {
    const m = { from: "111@lid", to: "me@c.us", fromMe: false, _data: { Info: { Chat: "111@lid", SenderAlt: "62812@s.whatsapp.net" } } };
    expect(messageChatId(m)).toBe("62812@c.us");
    expect(messageChatId({ from: "a@c.us", to: "b@c.us", fromMe: true })).toBe("b@c.us");
    expect(messageChatId({ from: "a@c.us", to: "b@c.us", fromMe: false, chatId: "x@g.us" })).toBe("x@g.us");
  });
});

describe("expandTemplate", () => {
  it("fills name and phone, case-insensitively", () => {
    expect(expandTemplate("Hi {Name} ({PHONE})", { name: "Adam", phone: "+62" })).toBe("Hi Adam (+62)");
    expect(expandTemplate("Hi {name}", {})).toBe("Hi ");
  });
});

describe("link previews", () => {
  it("isWebUrl accepts only http(s)", () => {
    expect(isWebUrl("https://example.com/x")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("file:///etc/passwd")).toBe(false);
    expect(isWebUrl("not a url")).toBe(false);
  });
  it("firstUrl strips trailing punctuation", () => {
    expect(firstUrl("see https://example.com/a). ok")).toBe("https://example.com/a");
    expect(firstUrl("no links")).toBeNull();
  });
  it("embeddedPreview needs at least a title, description or thumbnail", () => {
    const mk = (ext: object) => ({ _data: { Message: { extendedTextMessage: ext } } }) as unknown as WAMessage;
    expect(embeddedPreview(mk({ matchedText: "https://x.y" }))).toBeNull();
    expect(embeddedPreview(mk({ canonicalURL: "https://x.y", title: "X" }))?.url).toBe("https://x.y");
  });
});
