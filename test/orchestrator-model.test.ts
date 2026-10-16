import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTask } from "../src/core/orchestrator.js";
import { StateStore } from "../src/core/state.js";
import type { Config, RunFn, RunResult } from "../src/core/types.js";
import { noSummaryConfig } from "./helpers/config.js";

const OK: RunResult = { exitCode: 0, stdout: "done", stderr: "" };
const FAIL: RunResult = { exitCode: 2, stdout: "", stderr: "boom" };

function setup(results: Record<string, RunResult>) {
  const config: Config = {
    ...noSummaryConfig(),
    rules: [{ match: "typo", agent: "codex", model: "gpt-6-luna", effort: "low" }],
  };
  const calls: { command: string; args: string[] }[] = [];
  const run: RunFn = async (command, args) => {
    calls.push({ command, args });
    return results[command];
  };
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const state = new StateStore(join(dir, "s.json"));
  return { calls, state, deps: { config, state, run, now: () => 1 }, cwd: dir };
}

describe("per-rule model and effort", () => {
  it("passes the rule's model and effort to the chosen agent and records the model", async () => {
    const s = setup({ codex: OK, claude: OK });
    await runTask(s.deps, { prompt: "fix typo", cwd: s.cwd, depth: 0 });
    expect(s.calls[0].command).toBe("codex");
    expect(s.calls[0].args).toContain("gpt-6-luna");
    expect(s.calls[0].args).toContain('model_reasoning_effort="low"');
    expect(s.state.snapshot().jobs[0].model).toBe("gpt-6-luna");
  });

  it("does not apply the rule's model to the agent it fails over to", async () => {
    const s = setup({ codex: FAIL, claude: OK });
    const r = await runTask(s.deps, { prompt: "fix typo", cwd: s.cwd, depth: 0 });
    expect(r.failedOver).toBe(true);
    expect(s.calls[1].command).toBe("claude");
    expect(s.calls[1].args).not.toContain("gpt-6-luna");
    expect(s.calls[1].args.join(" ")).not.toContain("--model");
  });

  it("uses no model flags for a task that matches no model rule", async () => {
    const s = setup({ claude: OK, codex: OK });
    await runTask(s.deps, { prompt: "build a page", cwd: s.cwd, depth: 0 });
    expect(s.calls[0].args).toEqual(s.deps.config.agents.claude.args);
  });
});
