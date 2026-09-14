import { describe, expect, it } from "vitest";
import { nextOccurrence } from "@/store/scheduler";

const at = (y: number, mo: number, d: number, h = 9, mi = 0) => Math.floor(new Date(y, mo - 1, d, h, mi, 0, 0).getTime() / 1000);
const local = (unix: number) => new Date(unix * 1000);

describe("nextOccurrence", () => {
  it("returns null for one-shots", () => {
    expect(nextOccurrence({ next_run: at(2026, 1, 1), repeat: "once", weekdays: null }, at(2026, 1, 2))).toBeNull();
  });

  it("daily: same time-of-day, strictly after `after`", () => {
    const next = nextOccurrence({ next_run: at(2026, 1, 1, 9, 30), repeat: "daily", weekdays: null }, at(2026, 1, 1, 9, 30));
    expect(local(next!).getDate()).toBe(2);
    expect(local(next!).getHours()).toBe(9);
    expect(local(next!).getMinutes()).toBe(30);
  });

  it("weekly: next listed weekday", () => {
    // 2026-01-05 is a Monday. Rule: Mon (1) + Thu (4).
    const next = nextOccurrence({ next_run: at(2026, 1, 5), repeat: "weekly", weekdays: "1,4" }, at(2026, 1, 5, 9, 0));
    expect(local(next!).getDay()).toBe(4);
  });

  it("weekly: an empty weekday list falls back to the original weekday instead of disabling", () => {
    const next = nextOccurrence({ next_run: at(2026, 1, 5), repeat: "weekly", weekdays: "" }, at(2026, 1, 5, 9, 0));
    expect(next).not.toBeNull();
    expect(local(next!).getDay()).toBe(1);
    expect(local(next!).getDate()).toBe(12);
  });

  it("monthly: clamps to month length but returns to the anchor day-of-month afterwards", () => {
    const anchor = at(2026, 1, 31, 10, 0);
    const feb = nextOccurrence({ next_run: anchor, anchor, repeat: "monthly", weekdays: null }, anchor)!;
    expect(local(feb).getMonth()).toBe(1);
    expect(local(feb).getDate()).toBe(28);
    // After the clamped February run, next_run is the 28th — the anchor must still yield the 31st in March.
    const mar = nextOccurrence({ next_run: feb, anchor, repeat: "monthly", weekdays: null }, feb)!;
    expect(local(mar).getMonth()).toBe(2);
    expect(local(mar).getDate()).toBe(31);
  });

  it("monthly without an anchor (pre-migration rows) still advances", () => {
    const next = nextOccurrence({ next_run: at(2026, 3, 15), repeat: "monthly", weekdays: null }, at(2026, 3, 15))!;
    expect(local(next).getMonth()).toBe(3);
    expect(local(next).getDate()).toBe(15);
  });
});
