import { describe, expect, it } from "vitest";
import { appendUnique } from "@/screens/chats/useMessageList";
import { errMsg } from "@/lib/utils";
import type { WAMessage } from "@/api/types";

const msg = (id: string) => ({ id, timestamp: 1 }) as WAMessage;

describe("appendUnique", () => {
  it("drops ids already in the cache and keeps the requested side", () => {
    const old = [msg("a"), msg("b")];
    expect(appendUnique(old, [msg("b"), msg("c")], "end").map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(appendUnique(old, [msg("z"), msg("a")], "start").map((m) => m.id)).toEqual(["z", "a", "b"]);
  });
  it("returns the same array when nothing is new (no re-render churn)", () => {
    const old = [msg("a")];
    expect(appendUnique(old, [msg("a")], "end")).toBe(old);
  });
});

describe("errMsg", () => {
  it("unwraps Error and stringifies anything else", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
    expect(errMsg("plain")).toBe("plain");
    expect(errMsg({ code: 1 })).toBe("[object Object]");
  });
});
