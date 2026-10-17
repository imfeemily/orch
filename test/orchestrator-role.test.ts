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
