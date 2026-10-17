import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Ledger, type LedgerEntry, billableTokens, parseDuration, scheduleTrim, sumUsage, summarize } from "../src/core/usage.js";

const dir = () => mkdtempSync(join(tmpdir(), "orch-"));
const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  at: 1000,
  taskId: "t1",
  agent: "claude",
  outcome: "ok",
  durationMs: 5,
  promptChars: 10,
  usage: { inputTokens: 100, cacheReadTokens: 50, outputTokens: 20, costUsd: 0.01 },
  ...over,
});

describe("billableTokens", () => {
  it("is input plus output and ignores cache reads", () => {
    expect(billableTokens({ inputTokens: 10, cacheReadTokens: 999, outputTokens: 5 })).toBe(15);
  });
});

describe("Ledger", () => {
  it("round-trips entries and creates missing directories", () => {
    const l = new Ledger(join(dir(), "sub", "usage.jsonl"));
    l.append(entry());
    expect(l.readSince(0)).toEqual([entry()]);
  });

  it("creates the ledger file readable by its owner only", () => {
    const p = join(dir(), "usage.jsonl");
    new Ledger(p).append(entry());
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it("readSince returns only entries at or after the cutoff", () => {
    const l = new Ledger(join(dir(), "usage.jsonl"));
    l.append(entry({ at: 1000 }));
    l.append(entry({ at: 2000 }));
    expect(l.readSince(2000).map((e) => e.at)).toEqual([2000]);
  });

  it("skips corrupt lines", () => {
    const p = join(dir(), "usage.jsonl");
    const l = new Ledger(p);
    l.append(entry({ at: 1 }));
    writeFileSync(p, `${readFileSync(p, "utf8")}{not json\n`, "utf8");
    l.append(entry({ at: 2 }));
    expect(l.readSince(0).map((e) => e.at)).toEqual([1, 2]);
  });

  it("never throws when the path is unwritable", () => {
    const base = dir();
    const file = join(base, "file");
    writeFileSync(file, "x");
    const l = new Ledger(join(file, "sub", "usage.jsonl"));
    expect(() => l.append(entry())).not.toThrow();
    expect(l.readSince(0)).toEqual([]);
  });

  it("trim drops old entries, keeps new ones, and ignores a missing file", () => {
    const p = join(dir(), "usage.jsonl");
    const l = new Ledger(p);
    l.append(entry({ at: 100 }));
    l.append(entry({ at: 900 }));
    l.trim(500, 1000);
    expect(l.readSince(0).map((e) => e.at)).toEqual([900]);
    const missing = join(dir(), "none.jsonl");
    new Ledger(missing).trim(500, 1000);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("summarize", () => {
  const entries = [
    entry({ taskId: "a", agent: "claude", model: "opus" }),
    entry({ taskId: "b", agent: "claude", usage: undefined }),
    entry({ taskId: "c", agent: "codex", usage: { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 500 } }),
  ];

  it("sums per agent, counts tasks and sorts by billable tokens", () => {
    const rows = summarize(entries, "agent");
    expect(rows.map((r) => r.key)).toEqual(["codex", "claude"]);
    expect(rows[1]).toEqual({
      key: "claude", tasks: 2, inputTokens: 100, cacheReadTokens: 50, outputTokens: 20, billableTokens: 120, costUsd: 0.01,
    });
  });

  it("counts a task once per group even when it has several attempts, so a failover is one task", () => {
    const rows = summarize(
      [entry({ taskId: "t", agent: "claude" }), entry({ taskId: "t", agent: "codex" }), entry({ taskId: "t", agent: "codex" })],
      "agent",
    );
    expect(Object.fromEntries(rows.map((r) => [r.key, r.tasks]))).toEqual({ claude: 1, codex: 1 });
  });

  it("groups by context and labels a missing one (none)", () => {
    const rows = summarize([entry({ taskId: "a", context: "lean" }), entry({ taskId: "b", context: "lean" }), entry({ taskId: "c" })], "context");
    expect(rows.map((r) => [r.key, r.tasks]).sort()).toEqual([["(none)", 1], ["lean", 2]]);
  });

  it("groups by role and labels a missing one (none)", () => {
    const rows = summarize([entry({ taskId: "a", role: "reviewer" }), entry({ taskId: "b", role: "reviewer" }), entry({ taskId: "c" })], "role");
    expect(rows.map((r) => [r.key, r.tasks]).sort()).toEqual([["(none)", 1], ["reviewer", 2]]);
  });

  it("labels a missing model (default)", () => {
    expect(summarize(entries, "model").map((r) => r.key).sort()).toEqual(["(default)", "opus"]);
  });
});

describe("parseDuration", () => {
  it("parses minutes, hours and days", () => {
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseDuration("24h")).toBe(86_400_000);
    expect(parseDuration("7d")).toBe(604_800_000);
  });

  it("rejects anything else", () => {
    for (const bad of ["abc", "10", "0h", ""]) expect(parseDuration(bad)).toBeNull();
  });
});

describe("sumUsage", () => {
  it("adds token fields and cost, and returns undefined when nothing has usage", () => {
    expect(sumUsage([undefined, undefined])).toBeUndefined();
    expect(
      sumUsage([
        { inputTokens: 1, cacheReadTokens: 2, outputTokens: 3, costUsd: 0.5 },
        undefined,
        { inputTokens: 10, cacheReadTokens: 20, outputTokens: 30 },
      ]),
    ).toEqual({ inputTokens: 11, cacheReadTokens: 22, outputTokens: 33, costUsd: 0.5 });
  });
});

describe("scheduleTrim", () => {
  it("trims old entries on an interval, not only at start", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const l = new Ledger(join(dir(), "usage.jsonl"));
      l.append(entry({ at: 1_000 }));
      l.append(entry({ at: 10_000 }));
      const timer = scheduleTrim(l, 5_000, 500);
      vi.advanceTimersByTime(600);
      expect(l.readSince(0).map((e) => e.at)).toEqual([10_000]);
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });
});
