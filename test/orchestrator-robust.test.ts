import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTask } from "../src/core/orchestrator.js";
import { StateStore } from "../src/core/state.js";
import type { RunFn, RunOptions, RunResult } from "../src/core/types.js";
import { noSummaryConfig } from "./helpers/config.js";

const OK: RunResult = { exitCode: 0, stdout: "done", stderr: "" };
const LIMIT: RunResult = { exitCode: 1, stdout: "", stderr: "usage limit reached" };

describe("runTask robustness", () => {
  it("still returns the task result when the state file cannot be written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-"));
    const file = join(dir, "file");
    writeFileSync(file, "x");
    const state = new StateStore(join(file, "sub", "state.json")); // writes fail
    const run: RunFn = async (command) => (command === "claude" ? LIMIT : OK);
    const r = await runTask({ config: noSummaryConfig(), state, run, now: () => 1 }, { prompt: "task", cwd: dir, depth: 0 });
    expect(r).toMatchObject({ status: "ok", agent: "codex", failedOver: true, output: "done" });
  });

  it("passes the agent's timeoutSec to the run as milliseconds, and nothing when unset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-"));
    const seen: Array<RunOptions["timeoutMs"]> = [];
    const run: RunFn = async (_c, _a, _p, opts) => {
      seen.push(opts.timeoutMs);
      return OK;
    };
    const config = noSummaryConfig();
    const deps = { config, state: new StateStore(join(dir, "s.json")), run, now: () => 1 };
    await runTask(deps, { prompt: "task", cwd: dir, depth: 0 });
    config.agents.claude.timeoutSec = 5;
    await runTask(deps, { prompt: "task", cwd: dir, depth: 0 });
    expect(seen).toEqual([undefined, 5000]);
  });
});
