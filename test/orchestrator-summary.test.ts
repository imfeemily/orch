import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTask } from "../src/core/orchestrator.js";
import { StateStore } from "../src/core/state.js";
import type { RunFn, RunResult } from "../src/core/types.js";
import { noSummaryConfig, withSummaryConfig } from "./helpers/config.js";

const OK = (out: string): RunResult => ({ exitCode: 0, stdout: out, stderr: "" });
const LIMIT: RunResult = { exitCode: 1, stdout: "", stderr: "usage limit reached" };
const FAIL: RunResult = { exitCode: 2, stdout: "", stderr: "boom" };
const AUTH: RunResult = { exitCode: 1, stdout: "Failed to authenticate: OAuth session expired\n", stderr: "" };

function setup(
  config: ReturnType<typeof withSummaryConfig>,
  summaryResult: RunResult,
  first: RunResult = FAIL,
) {
  const calls: { command: string; args: string[]; prompt: string; timeoutMs?: number }[] = [];
  const mainResults: Record<string, RunResult[]> = { claude: [first], codex: [OK("final")] };
  const run: RunFn = async (command, args, prompt, opts) => {
    calls.push({ command, args, prompt, timeoutMs: opts.timeoutMs });
    if (args[0] === "--summary") return summaryResult;
    return mainResults[command].shift()!;
  };
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const deps = { config, state: new StateStore(join(dir, "s.json")), run, now: () => 1 };
  return { calls, deps, cwd: dir };
}

describe("handoff summary", () => {
  it("asks the first agent for a summary and passes it on", async () => {
    const s = setup(withSummaryConfig(), OK("did steps 1-2"));
    const r = await runTask(s.deps, { prompt: "big task", cwd: s.cwd, depth: 0 });
    expect(r.status).toBe("ok");
    const summaryCall = s.calls.find((c) => c.args[0] === "--summary")!;
    expect(summaryCall.command).toBe("claude");
    expect(summaryCall.timeoutMs).toBe(60_000);
    const lastCall = s.calls[s.calls.length - 1];
    expect(lastCall.command).toBe("codex");
    expect(lastCall.prompt).toContain("Summary from previous agent\ndid steps 1-2");
  });

  it("continues without a summary when the summary call fails", async () => {
    const s = setup(withSummaryConfig(), { exitCode: 1, stdout: "", stderr: "limit" });
    const r = await runTask(s.deps, { prompt: "big task", cwd: s.cwd, depth: 0 });
    expect(r.status).toBe("ok");
    const lastCall = s.calls[s.calls.length - 1];
    expect(lastCall.prompt).not.toContain("Summary from previous agent");
  });

  it("skips the summary when the first agent hit a limit (resume cannot succeed)", async () => {
    const s = setup(withSummaryConfig(), OK("unused"), LIMIT);
    await runTask(s.deps, { prompt: "big task", cwd: s.cwd, depth: 0 });
    expect(s.calls.some((c) => c.args[0] === "--summary")).toBe(false);
  });

  it("skips the summary when the first agent is not logged in", async () => {
    const s = setup(withSummaryConfig(), OK("unused"), AUTH);
    await runTask(s.deps, { prompt: "big task", cwd: s.cwd, depth: 0 });
    expect(s.calls.some((c) => c.args[0] === "--summary")).toBe(false);
  });

  it("makes no summary call when summaryArgs is not configured", async () => {
    const s = setup(noSummaryConfig(), OK("unused"));
    await runTask(s.deps, { prompt: "big task", cwd: s.cwd, depth: 0 });
    expect(s.calls.some((c) => c.args[0] === "--summary")).toBe(false);
  });
});
