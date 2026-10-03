import { describe, expect, it } from "vitest";
import { chatKey, unreadFor } from "@/store/unread";

const now = Math.floor(Date.now() / 1000);
const session = "default";
const chatId = "6281234@c.us";
const key = chatKey(session, chatId);

describe("unreadFor", () => {
  it("returns the live count when one is tracked", () => {
    expect(unreadFor({ counts: { [key]: 3 }, lastSeen: {} }, session, chatId, { fromMe: false, timestamp: now })).toBe(3);
  });

  it("flags a message newer than the last open", () => {
    expect(unreadFor({ counts: {}, lastSeen: { [key]: now - 60 } }, session, chatId, { fromMe: false, timestamp: now })).toBe(1);
  });

  it("ignores a far-future timestamp instead of pinning the chat unread", () => {
    const corrupt = now + 3 * 24 * 60 * 60;
    expect(unreadFor({ counts: {}, lastSeen: { [key]: now - 60 } }, session, chatId, { fromMe: false, timestamp: corrupt })).toBe(0);
  });

  it("ignores my own messages and chats never opened", () => {
    expect(unreadFor({ counts: {}, lastSeen: { [key]: now - 60 } }, session, chatId, { fromMe: true, timestamp: now })).toBe(0);
    expect(unreadFor({ counts: {}, lastSeen: {} }, session, chatId, { fromMe: false, timestamp: now })).toBe(0);
  });
});
