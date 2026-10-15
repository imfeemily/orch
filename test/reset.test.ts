import { describe, expect, it } from "vitest";
import { parseResetTime } from "../src/core/reset.js";

const local = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 15 + dayOffset, h, m).getTime();
const now = local(18, 0);

describe("parseResetTime", () => {
  it("reads 'try again at 10:05 PM' as the next local 22:05", () => {
    const t = "You've hit your usage limit. Upgrade to Pro or try again at 10:05 PM.";
    expect(parseResetTime(t, now)).toBe(local(22, 5));
  });

  it("rolls over to tomorrow when the time already passed today", () => {
    expect(parseResetTime("try again at 10:05 PM", local(23, 0))).toBe(local(22, 5, 1));
  });

  it("handles hours without minutes and 12 AM / 12 PM", () => {
    expect(parseResetTime("resets at 9pm", now)).toBe(local(21, 0));
    expect(parseResetTime("resets at 12:30 AM", now)).toBe(local(0, 30, 1));
    expect(parseResetTime("resets at 12 PM", local(8, 0))).toBe(local(12, 0));
  });

  it("reads an epoch-seconds suffix", () => {
    const base = 1_759_999_000_000;
    expect(parseResetTime("Claude AI usage limit reached|1760000000", base)).toBe(1_760_000_000_000);
  });

  it("reads relative durations", () => {
    expect(parseResetTime("try again in 2 hours", now)).toBe(now + 2 * 3_600_000);
    expect(parseResetTime("retry after 30 minutes", now)).toBe(now + 30 * 60_000);
  });

  it("returns null when nothing matches or the time is out of range", () => {
    expect(parseResetTime("something went wrong", now)).toBeNull();
    expect(parseResetTime("limit|1000000000", now)).toBeNull();
    expect(parseResetTime("try again in 400 days", now)).toBeNull();
  });
});
