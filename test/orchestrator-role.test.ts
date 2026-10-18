import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTask } from "../src/core/orchestrator.js";
import { StateStore } from "../src/core/state.js";
import type { Config, RunFn, RunResult } from "../src/core/types.js";
import { Ledger } from "../src/core/usage.js";
import { noSummaryConfig } from "./helpers/config.js";

const OK: RunResult = { exitCode: 0, stdout: "done", stderr: "" };
const FAIL: RunResult = { exitCode: 2, stdout: "", stderr: "boom" };

function setup(results: Record<string, RunResult>, tweak?: (c: Config) => void) {
  const config = noSummaryConfig();
  config.roles.pic = { prompt: "p", needs: ["image"], writes: false };
  tweak?.(config);
  const calls: { command: string; args: string[] }[] = [];
  const run: RunFn = async (command, args) => {
    calls.push({ command, args });
    return results[command];
  };
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const state = new StateStore(join(dir, "s.json"));
  const ledger = new Ledger(join(dir, "usage.jsonl"));
  return { calls, state, ledger, config, deps: { config, state, run, ledger, now: () => 1 }, cwd: dir };
}
const go = (s: ReturnType<typeof setup>, role?: string, runId?: string) =>
  runTask(s.deps, { prompt: "build a page", cwd: s.cwd, depth: 0, role, runId });

describe("runTask with a role", () => {
  it("applies the role's agent args before --", async () => {
    const s = setup({ claude: OK, codex: OK });
    await go(s, "developer");
    const args = s.calls[0].args;
    expect(s.calls[0].command).toBe("claude");
    expect(args).toContain("acceptEdits");
    expect(args.indexOf("acceptEdits")).toBeLessThan(args.indexOf("--"));
  });

  it("applies the role's model, effort and context", async () => {
    const s = setup({ claude: OK, codex: OK }, (c) => {
      c.roles.reviewer.model = "haiku";
      c.roles.reviewer.effort = "low";
    });
    await go(s, "reviewer");
    const args = s.calls[0].args;
    for (const a of ["--model", "haiku", "--effort", "low", "--setting-sources"]) expect(args).toContain(a);
  });

  it("gives the other agent its own role args after a failover", async () => {
    const s = setup({ claude: FAIL, codex: OK });
    const r = await go(s, "developer");
    expect(r.failedOver).toBe(true);
    expect(s.calls[1].command).toBe("codex");
    expect(s.calls[1].args).toContain("workspace-write");
    expect(s.calls[1].args).not.toContain("acceptEdits");
  });

  it("never fails a role that needs a capability over to the other agent", async () => {
    const s = setup({ codex: FAIL, claude: OK });
    const r = await go(s, "pic");
    expect(s.calls.map((c) => c.command)).toEqual(["codex"]);
    expect(r.status).toBe("failed");
    expect(r.message).toContain("cannot fail over");
  });

  it("is unavailable, running nothing, when the agent a role needs is cooling down", async () => {
    const s = setup({ codex: OK, claude: OK });
    s.state.setCooldown("codex", 9_999_999);
    const r = await go(s, "pic");
    expect(r.status).toBe("unavailable");
    expect(r.message).toContain("codex");
    expect(s.calls).toHaveLength(0);
  });

  it("records the role on ledger and job entries and uses runId as the task id", async () => {
    const s = setup({ claude: OK, codex: OK });
    await go(s, "reviewer", "run12345");
    const e = s.ledger.readSince(0)[0];
    expect(e).toMatchObject({ role: "reviewer", taskId: "run12345" });
    expect(s.state.snapshot().jobs[0].role).toBe("reviewer");
  });

  it("rejects an unknown role, naming the valid ones, without running anything", async () => {
    const s = setup({ claude: OK, codex: OK });
    const r = await go(s, "wizard");
    expect(r.status).toBe("rejected");
    expect(r.message).toContain("developer");
    expect(s.calls).toHaveLength(0);
  });

  it("is unchanged without a role", async () => {
    const s = setup({ claude: OK, codex: OK });
    await go(s);
    expect(s.calls[0].args).toEqual(s.config.agents.claude.args);
    expect(s.ledger.readSince(0)[0].role).toBeUndefined();
  });
});

describe("runTask with only", () => {
  const goOnly = (s: ReturnType<typeof setup>, only: "claude" | "codex", prompt: string) =>
    runTask(s.deps, { prompt, cwd: s.cwd, depth: 0, only });

  it("runs the pinned agent with the tier's model, effort and context", async () => {
    const s = setup({ claude: OK, codex: OK });
    const r = await goOnly(s, "claude", "fix a typo in the README");
    expect(r.status).toBe("ok");
    expect(s.calls).toHaveLength(1);
    for (const a of ["--model", "haiku", "--effort", "low", "--setting-sources"]) expect(s.calls[0].args).toContain(a);
  });

  it("lets the agent edit files with its own write flags, unless the tier says no", async () => {
    const s = setup({ claude: OK, codex: OK });
    await goOnly(s, "claude", "fix a typo");
    expect(s.calls[0].args).toContain("acceptEdits");
    expect(s.calls[0].args.indexOf("acceptEdits")).toBeLessThan(s.calls[0].args.indexOf("--"));
    await goOnly(s, "codex", "fix a typo");
    expect(s.calls[1].args).toContain("workspace-write");
    const ro = setup({ claude: OK, codex: OK }, (c) => { c.tiers.claude.small.write = false; });
    await goOnly(ro, "claude", "fix a typo");
    expect(ro.calls[0].args).not.toContain("acceptEdits");
  });

  it("does not go to the other agent even when a rule would pick it", async () => {
    const s = setup({ claude: OK, codex: OK });
    await goOnly(s, "claude", "fix a typo");
    expect(s.calls.map((c) => c.command)).toEqual(["claude"]);
  });

  it("never fails over: a failure stays a failure and says so", async () => {
    const s = setup({ claude: FAIL, codex: OK });
    const r = await goOnly(s, "claude", "add a login page");
    expect(r.status).toBe("failed");
    expect(r.failedOver).toBe(false);
    expect(r.message).toContain("--only claude");
    expect(s.calls).toHaveLength(1);
  });

  it("is unavailable, not rerouted, while the pinned agent is cooling down", async () => {
    const s = setup({ claude: OK, codex: OK });
    s.state.setCooldown("claude", Date.now() + 3_600_000);
    const s2 = { ...s, deps: { ...s.deps, now: () => Date.now() } };
    const r = await goOnly(s2, "claude", "add a login page");
    expect(r.status).toBe("unavailable");
    expect(r.message).toContain("claude");
    expect(s.calls).toHaveLength(0);
  });

  it("rejects --only together with a role", async () => {
    const s = setup({ claude: OK, codex: OK });
    const r = await runTask(s.deps, { prompt: "x", cwd: s.cwd, depth: 0, only: "claude", role: "reviewer" });
    expect(r.status).toBe("rejected");
  });
});
