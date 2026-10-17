import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/core/state.js";
import type { JobEntry } from "../src/core/types.js";

function storePath(): string {
  return join(mkdtempSync(join(tmpdir(), "orch-")), "state.json");
}

const job = (n: number): JobEntry => ({
  at: n,
  agent: "claude",
  status: "ok",
  failedOver: false,
  promptPreview: `job ${n}`,
});

describe("StateStore", () => {
  it("writes the state file readable by its owner only", () => {
    const p = storePath();
    new StateStore(p).setCooldown("claude", 5);
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it("starts with no cooldowns", () => {
    const s = new StateStore(storePath());
    expect(s.isCooling("claude", 1000)).toBe(false);
  });

  it("cools until the given time", () => {
    const s = new StateStore(storePath());
    s.setCooldown("codex", 5000);
    expect(s.isCooling("codex", 4999)).toBe(true);
    expect(s.isCooling("codex", 5000)).toBe(false);
    expect(s.isCooling("claude", 4999)).toBe(false);
  });

  it("persists across instances", () => {
    const p = storePath();
    new StateStore(p).setCooldown("claude", 9000);
    expect(new StateStore(p).cooldownUntil("claude")).toBe(9000);
  });

  it("treats a corrupt file as empty", () => {
    const p = storePath();
    writeFileSync(p, "{not json");
    const s = new StateStore(p);
    expect(s.isCooling("claude", 1)).toBe(false);
    s.setCooldown("claude", 10);
    expect(s.cooldownUntil("claude")).toBe(10);
  });

  it("treats a JSON null file as empty", () => {
    const p = storePath();
    writeFileSync(p, "null");
    expect(new StateStore(p).snapshot().jobs).toEqual([]);
  });

  it("keeps only the last 50 jobs", () => {
    const s = new StateStore(storePath());
    for (let i = 0; i < 60; i++) s.appendJob(job(i));
    const jobs = s.snapshot().jobs;
    expect(jobs).toHaveLength(50);
    expect(jobs[0].at).toBe(10);
    expect(jobs[49].at).toBe(59);
  });
});
