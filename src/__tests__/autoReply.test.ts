import { describe, expect, it } from "vitest";
import { inWindow, scopeMatches, textMatches } from "@/store/autoReply";

describe("scopeMatches", () => {
  it("never answers channels or status", () => {
    expect(scopeMatches({ scope: "all", chat_ids: null }, "123@newsletter")).toBe(false);
    expect(scopeMatches({ scope: "all", chat_ids: null }, "status@broadcast")).toBe(false);
  });
  it("dm / groups / chats", () => {
    expect(scopeMatches({ scope: "dm", chat_ids: null }, "62812@c.us")).toBe(true);
    expect(scopeMatches({ scope: "dm", chat_ids: null }, "123-456@g.us")).toBe(false);
    expect(scopeMatches({ scope: "groups", chat_ids: null }, "123-456@g.us")).toBe(true);
    expect(scopeMatches({ scope: "chats", chat_ids: JSON.stringify(["a@c.us"]) }, "a@c.us")).toBe(true);
    expect(scopeMatches({ scope: "chats", chat_ids: JSON.stringify(["a@c.us"]) }, "b@c.us")).toBe(false);
    expect(scopeMatches({ scope: "chats", chat_ids: "not json" }, "a@c.us")).toBe(false);
  });
});

describe("textMatches", () => {
  it("any / empty pattern always matches", () => {
    expect(textMatches({ match_kind: "any", pattern: null }, "hello")).toBe(true);
    expect(textMatches({ match_kind: "keywords", pattern: "  " }, "hello")).toBe(true);
  });
  it("keywords are comma-separated and case-insensitive", () => {
    expect(textMatches({ match_kind: "keywords", pattern: "Harga, Stok" }, "berapa HARGA nya?")).toBe(true);
    expect(textMatches({ match_kind: "keywords", pattern: "harga" }, "halo")).toBe(false);
  });
  it("regex: invalid pattern never matches instead of throwing", () => {
    expect(textMatches({ match_kind: "regex", pattern: "^order\\s+\\d+" }, "Order 12")).toBe(true);
    expect(textMatches({ match_kind: "regex", pattern: "(" }, "anything")).toBe(false);
  });
});

describe("inWindow", () => {
  const sat0100 = new Date(2026, 0, 10, 1, 0); // Saturday
  const fri2000 = new Date(2026, 0, 9, 20, 0); // Friday
  it("no window → always", () => {
    expect(inWindow({ hours_from: null, hours_to: null, weekdays: null }, sat0100)).toBe(true);
  });
  it("plain window", () => {
    expect(inWindow({ hours_from: "09:00", hours_to: "17:00", weekdays: null }, new Date(2026, 0, 9, 12, 0))).toBe(true);
    expect(inWindow({ hours_from: "09:00", hours_to: "17:00", weekdays: null }, new Date(2026, 0, 9, 17, 0))).toBe(false);
  });
  it("a window wrapping past midnight belongs to the day it started", () => {
    const r = { hours_from: "18:00", hours_to: "08:00", weekdays: "5" }; // Fridays only
    expect(inWindow(r, fri2000)).toBe(true);
    expect(inWindow(r, sat0100)).toBe(true); // Friday night
    expect(inWindow(r, new Date(2026, 0, 10, 20, 0))).toBe(false); // Saturday evening
  });
});
