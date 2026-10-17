import { describe, expect, it } from "vitest";
import { formatUsage } from "../src/cli/usage-report.js";
import type { UsageRow } from "../src/core/usage.js";

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  key: "claude", tasks: 2, inputTokens: 1000, cacheReadTokens: 500, outputTokens: 234, billableTokens: 1234, costUsd: 0,
  ...over,
});

describe("formatUsage", () => {
  it("says so when nothing was recorded", () => {
    expect(formatUsage([], "24h")).toBe("no usage recorded in the last 24h");
  });

  it("prints key, task count and billable tokens with separators", () => {
    const out = formatUsage([row()], "7d");
    expect(out).toContain("last 7d");
    expect(out).toContain("claude");
    expect(out).toContain("2 tasks");
    expect(out).toContain("1,234 tokens");
  });

  it("shows cost only when it is above zero", () => {
    expect(formatUsage([row()], "24h")).not.toContain("$");
    expect(formatUsage([row({ costUsd: 0.042 })], "24h")).toContain("$0.0420");
  });
});
