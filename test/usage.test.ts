import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Ledger, type LedgerEntry, billableTokens, parseDuration, summarize } from "../src/core/usage.js";

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
    entry({ agent: "claude", model: "opus" }),
    entry({ agent: "claude", usage: undefined }),
    entry({ agent: "codex", usage: { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 500 } }),
  ];

  it("sums per agent, counts tasks and sorts by billable tokens", () => {
    const rows = summarize(entries, "agent");
    expect(rows.map((r) => r.key)).toEqual(["codex", "claude"]);
    expect(rows[1]).toEqual({
      key: "claude", tasks: 2, inputTokens: 100, cacheReadTokens: 50, outputTokens: 20, billableTokens: 120, costUsd: 0.01,
    });
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
