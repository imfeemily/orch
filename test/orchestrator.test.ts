import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTask } from "../src/core/orchestrator.js";
import { StateStore } from "../src/core/state.js";
import type { RunFn, RunResult } from "../src/core/types.js";
import { noSummaryConfig } from "./helpers/config.js";

const OK = (out = "done"): RunResult => ({ exitCode: 0, stdout: out, stderr: "" });
const LIMIT: RunResult = { exitCode: 1, stdout: "", stderr: "usage limit reached" };
const FAIL: RunResult = { exitCode: 2, stdout: "", stderr: "boom" };
const MISSING: RunResult = { exitCode: null, stdout: "", stderr: "orch: failed to start claude: ENOENT" };

interface Call { command: string; prompt: string }

function harness(table: Record<string, RunResult[]>) {
  const calls: Call[] = [];
  const run: RunFn = async (command, _args, prompt) => {
    calls.push({ command, prompt });
    return table[command].shift()!;
  };
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const state = new StateStore(join(dir, "state.json"));
  const deps = { config: noSummaryConfig(), state, run, now: () => 1_000_000 };
  return { calls, state, deps, cwd: dir };
}

describe("runTask", () => {
  it("returns the first agent's result on success", async () => {
    const h = harness({ claude: [OK("hello")], codex: [] });
    const r = await runTask(h.deps, { prompt: "add a page", cwd: h.cwd, depth: 0 });
    expect(r).toMatchObject({ status: "ok", agent: "claude", output: "hello", failedOver: false });
    expect(h.calls.map((c) => c.command)).toEqual(["claude"]);
  });

  it("routes by rule", async () => {
    const h = harness({ claude: [], codex: [OK()] });
    const r = await runTask(h.deps, { prompt: "fix typo in README", cwd: h.cwd, depth: 0 });
    expect(r.agent).toBe("codex");
  });

  it("fails over on a limit, sets a cooldown and sends a handoff prompt", async () => {
    const h = harness({ claude: [LIMIT], codex: [OK("from codex")] });
    const r = await runTask(h.deps, { prompt: "build the thing", cwd: h.cwd, depth: 0 });
    expect(r).toMatchObject({ status: "ok", agent: "codex", failedOver: true, output: "from codex" });
    expect(h.state.isCooling("claude", 1_000_000)).toBe(true);
    expect(h.calls[1].prompt).toContain("## Original task\nbuild the thing");
  });

  it("fails over on a plain failure without a cooldown", async () => {
    const h = harness({ claude: [FAIL], codex: [OK()] });
    const r = await runTask(h.deps, { prompt: "task", cwd: h.cwd, depth: 0 });
    expect(r).toMatchObject({ status: "ok", agent: "codex", failedOver: true });
    expect(h.state.isCooling("claude", 1_000_000)).toBe(false);
  });

  it("fails over when the first binary is not installed", async () => {
    const h = harness({ claude: [MISSING], codex: [OK()] });
    const r = await runTask(h.deps, { prompt: "task", cwd: h.cwd, depth: 0 });
    expect(r).toMatchObject({ status: "ok", agent: "codex", failedOver: true });
  });

  it("fails over at most once", async () => {
    const h = harness({ claude: [LIMIT], codex: [FAIL] });
    const r = await runTask(h.deps, { prompt: "task", cwd: h.cwd, depth: 0 });
    expect(r.status).toBe("failed");
    expect(r.attempts).toHaveLength(2);
    expect(h.calls).toHaveLength(2);
  });

  it("is unavailable when both agents are cooling, without running anything", async () => {
    const h = harness({ claude: [], codex: [] });
    h.state.setCooldown("claude", 2_000_000);
    h.state.setCooldown("codex", 2_000_000);
    const r = await runTask(h.deps, { prompt: "task", cwd: h.cwd, depth: 0 });
    expect(r.status).toBe("unavailable");
    expect(r.message).toContain("cooling down");
    expect(h.calls).toHaveLength(0);
  });

  it("skips a cooling preferred agent", async () => {
    const h = harness({ claude: [], codex: [OK()] });
    h.state.setCooldown("claude", 2_000_000);
    const r = await runTask(h.deps, { prompt: "task", cwd: h.cwd, depth: 0 });
    expect(r).toMatchObject({ status: "ok", agent: "codex", failedOver: false });
  });

  it("reports failure without failover when the other agent is cooling", async () => {
    const h = harness({ claude: [FAIL], codex: [] });
    h.state.setCooldown("codex", 2_000_000);
    const r = await runTask(h.deps, { prompt: "task", cwd: h.cwd, depth: 0 });
    expect(r.status).toBe("failed");
    expect(r.failedOver).toBe(false);
  });

  it("does not treat an echoed handoff prompt as a rate limit", async () => {
    // Real CLIs (codex) echo the prompt to stderr; the handoff text itself says "rate limit".
    const dir = mkdtempSync(join(tmpdir(), "orch-"));
    const state = new StateStore(join(dir, "state.json"));
    const run: RunFn = async (command, _args, prompt) =>
      command === "claude"
        ? LIMIT
        : { exitCode: 1, stdout: "", stderr: `user\n${prompt}\nERROR: model not supported` };
    const r = await runTask(
      { config: noSummaryConfig(), state, run, now: () => 1_000_000 },
      { prompt: "task", cwd: dir, depth: 0 },
    );
    expect(r.attempts[1].outcome).toBe("failed");
    expect(state.isCooling("codex", 1_000_000)).toBe(false);
  });

  it("does not fail over after the caller aborted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-"));
    const state = new StateStore(join(dir, "state.json"));
    const ac = new AbortController();
    const calls: string[] = [];
    const run: RunFn = async (command) => {
      calls.push(command);
      ac.abort();
      return LIMIT;
    };
    const r = await runTask(
      { config: noSummaryConfig(), state, run, now: () => 1_000_000 },
      { prompt: "task", cwd: dir, depth: 0, signal: ac.signal },
    );
    expect(calls).toEqual(["claude"]);
    expect(r.status).toBe("failed");
    expect(r.message).toContain("aborted");
  });

  it("rejects recursion", async () => {
    const h = harness({ claude: [], codex: [] });
    const r = await runTask(h.deps, { prompt: "task", cwd: h.cwd, depth: 1 });
    expect(r.status).toBe("rejected");
    expect(h.calls).toHaveLength(0);
  });

  it("records a job entry", async () => {
    const h = harness({ claude: [OK()], codex: [] });
    await runTask(h.deps, { prompt: "task", cwd: h.cwd, depth: 0 });
    expect(h.state.snapshot().jobs).toHaveLength(1);
    expect(h.state.snapshot().jobs[0]).toMatchObject({ agent: "claude", status: "ok" });
  });
});
