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

function setup(results: Record<string, RunResult>) {
  const config: Config = {
    ...noSummaryConfig(),
    rules: [{ match: "typo", agent: "codex", context: "lean" }],
  };
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
const lean = (s: ReturnType<typeof setup>) => s.config.contexts.lean;
const go = (s: ReturnType<typeof setup>, prompt: string, context?: string) =>
  runTask(s.deps, { prompt, cwd: s.cwd, depth: 0, context });

describe("context presets", () => {
  it("applies the rule's context preset for the chosen agent, before --", async () => {
    const s = setup({ codex: OK, claude: OK });
    await go(s, "fix typo");
    const args = s.calls[0].args;
    for (const a of lean(s).codex!) expect(args).toContain(a);
    expect(args.indexOf(lean(s).codex![0])).toBeLessThan(args.indexOf("--"));
  });

  it("uses the other agent's own preset after a failover", async () => {
    const s = setup({ codex: FAIL, claude: OK });
    const r = await go(s, "fix typo");
    expect(r.failedOver).toBe(true);
    expect(s.calls[1].command).toBe("claude");
    for (const a of lean(s).claude!) expect(s.calls[1].args).toContain(a);
    expect(s.calls[1].args).not.toContain("--disable");
  });

  it("lets an explicit context override the rule's", async () => {
    const s = setup({ codex: OK, claude: OK });
    await go(s, "fix typo", "minimal");
    for (const a of s.config.contexts.minimal.codex!) expect(s.calls[0].args).toContain(a);
  });

  it("applies an explicit context to a task no rule matched", async () => {
    const s = setup({ codex: OK, claude: OK });
    await go(s, "build a page", "lean");
    expect(s.calls[0].command).toBe("claude");
    for (const a of lean(s).claude!) expect(s.calls[0].args).toContain(a);
  });

  it("rejects an unknown context, naming the valid ones, without running anything", async () => {
    const s = setup({ codex: OK, claude: OK });
    const r = await go(s, "fix typo", "nope");
    expect(r.status).toBe("rejected");
    expect(r.message).toContain("nope");
    expect(r.message).toContain("lean");
    expect(s.calls).toHaveLength(0);
  });

  it("uses the plain args when no context applies", async () => {
    const s = setup({ codex: OK, claude: OK });
    await go(s, "build a page");
    expect(s.calls[0].args).toEqual(s.config.agents.claude.args);
  });

  it("records the context on ledger and job entries", async () => {
    const s = setup({ codex: OK, claude: OK });
    await go(s, "fix typo");
    expect(s.ledger.readSince(0)[0].context).toBe("lean");
    expect(s.state.snapshot().jobs[0].context).toBe("lean");
  });
});
