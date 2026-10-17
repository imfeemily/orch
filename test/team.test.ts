import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/core/state.js";
import type { Config, RunFn, RunResult } from "../src/core/types.js";
import { Ledger } from "../src/core/usage.js";
import type { ReadinessChecker } from "../src/core/readiness.js";
import { runRoles } from "../src/core/team.js";
import { noSummaryConfig } from "./helpers/config.js";

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: "" });
const FAIL: RunResult = { exitCode: 2, stdout: "", stderr: "boom" };
const READY: ReadinessChecker = async () => ({ ready: true, reasons: [] });
const NOT_READY: ReadinessChecker = async () => ({ ready: false, reasons: ["not logged in: run `codex login`"] });

function setup(outputs: Record<string, RunResult>, opts: { readiness?: ReadinessChecker; tweak?: (c: Config) => void } = {}) {
  const config = noSummaryConfig();
  config.roles.pic = { prompt: "You are the picture maker.", needs: ["image"], writes: false };
  opts.tweak?.(config);
  const calls: { command: string; prompt: string; role: string }[] = [];
  let abort: (() => void) | undefined;
  const run: RunFn = async (command, _args, prompt) => {
    const role = Object.keys(config.roles).find((r) => prompt.includes(config.roles[r].prompt)) ?? "?";
    calls.push({ command, prompt, role });
    const r = outputs[role] ?? ok(`${role} output\n## Handoff\n${role} handoff`);
    if (role === "developer") abort?.();
    return r;
  };
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const cwd = join(dir, "project");
  mkdirSync(cwd);
  const state = new StateStore(join(dir, "s.json"));
  const ledger = new Ledger(join(dir, "usage.jsonl"));
  const ac = new AbortController();
  return {
    calls, cwd, ledger, config, signal: ac.signal, abortAfterDeveloper: () => (abort = () => ac.abort()),
    deps: { config, state, run, ledger, now: () => 1, readiness: opts.readiness ?? READY },
  };
}
type S = ReturnType<typeof setup>;
const go = (s: S, sel: object, extra: object = {}) => runRoles(s.deps, { task: "add clamp tests", cwd: s.cwd, depth: 0, ...sel, ...extra });

describe("runRoles: single role", () => {
  it("runs one role, prints its answer, and writes no artifacts", async () => {
    const s = setup({ reviewer: ok("looks fine") });
    const r = await go(s, { role: "reviewer" });
    expect(r).toMatchObject({ status: "ok", output: "looks fine" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].prompt.startsWith(s.config.roles.reviewer.prompt)).toBe(true);
    expect(s.calls[0].prompt).not.toContain("## Handoff");
    expect(existsSync(join(s.cwd, ".orch"))).toBe(false);
  });

  it("fails without running when the role needs a capability the agent lacks", async () => {
    const s = setup({}, { readiness: NOT_READY });
    const r = await go(s, { role: "pic" });
    expect(r.status).toBe("failed");
    expect(r.message).toContain("codex login");
    expect(s.calls).toHaveLength(0);
  });
});

describe("runRoles: team", () => {
  it("runs the standard team in order, passing handoffs forward and writing artifacts", async () => {
    const s = setup({});
    writeFileSync(join(s.cwd, ".gitignore"), "node_modules\n");
    const r = await go(s, { team: "standard" });
    expect(s.calls.map((c) => c.role)).toEqual(["developer", "tester", "reviewer"]);
    expect(s.calls[1].prompt).toContain("### developer\ndeveloper handoff");
    expect(s.calls[2].prompt).toContain("### tester\ntester handoff");
    expect(s.calls[2].prompt).toContain("### developer\ndeveloper handoff");
    expect(r.status).toBe("ok");
    expect(r.roles!.map((x) => [x.role, x.status])).toEqual([["developer", "ok"], ["tester", "ok"], ["reviewer", "ok"]]);
    for (const x of r.roles!) expect(readFileSync(x.artifact!, "utf8")).toContain(`${x.role} output`);
    const runs = join(s.cwd, ".orch", "runs");
    expect(readFileSync(join(runs, ".gitignore"), "utf8")).toBe("*\n");
    expect(readFileSync(join(s.cwd, ".gitignore"), "utf8")).toBe("node_modules\n");
    const ids = new Set(s.ledger.readSince(0).map((e) => e.taskId));
    expect(ids.size).toBe(1);
  });

  it("falls back to the output tail (1,500 characters) when there is no Handoff heading", async () => {
    const s = setup({ developer: ok(`${"x".repeat(6000)}END`) });
    await go(s, { team: "standard" });
    const tester = s.calls[1].prompt;
    expect(tester).toContain("END");
    expect(tester).not.toContain("x".repeat(1600));
  });

  it("caps the handoffs passed to the next role at pipeline.handoffChars", async () => {
    const s = setup({ developer: ok(`done\n## Handoff\n${"y".repeat(5000)}`) }, { tweak: (c) => (c.pipeline.handoffChars = 200) });
    await go(s, { team: "standard" });
    const tester = s.calls[1].prompt;
    expect(tester).toContain("y".repeat(200));
    expect(tester).not.toContain("y".repeat(201));
  });

  it("stops after a failing role and reports the rest as not-run", async () => {
    const s = setup({ developer: FAIL });
    const r = await go(s, { team: "standard" });
    expect(r.status).toBe("failed");
    expect(r.roles!.map((x) => x.status)).toEqual(["failed", "not-run", "not-run"]);
    expect(s.calls.every((c) => c.role === "developer")).toBe(true);
  });

  it("keeps going after a failure when asked", async () => {
    const s = setup({ developer: FAIL });
    const r = await go(s, { team: "standard" }, { keepGoing: true });
    expect(r.status).toBe("failed");
    expect(r.roles!.map((x) => x.status)).toEqual(["failed", "ok", "ok"]);
  });

  it("cancels the remaining roles when aborted", async () => {
    const s = setup({});
    s.abortAfterDeveloper();
    const r = await go(s, { team: "standard" }, { signal: s.signal });
    expect(r.roles!.map((x) => x.status)).toEqual(["ok", "not-run", "not-run"]);
    expect(r.status).toBe("failed");
    expect(s.calls).toHaveLength(1);
  });

  it("does not fail the run when artifacts cannot be written", async () => {
    const s = setup({});
    writeFileSync(join(s.cwd, ".orch"), "i am a file");
    const r = await go(s, { team: "standard" });
    expect(r.status).toBe("ok");
    expect(r.roles!.every((x) => x.artifact === undefined)).toBe(true);
  });
});

describe("runRoles: readiness gate", () => {
  it("skips a role that needs a capability when codex is not ready, and still runs the others", async () => {
    const s = setup({}, { readiness: NOT_READY });
    const r = await go(s, { roles: ["pic", "developer"] });
    expect(r.status).toBe("ok");
    expect(r.roles![0]).toMatchObject({ role: "pic", status: "skipped" });
    expect(r.roles![0].reason).toContain("codex login");
    expect(s.calls.map((c) => c.role)).toEqual(["developer"]);
  });

  it("stops before anything runs with requireCodex", async () => {
    const s = setup({}, { readiness: NOT_READY });
    const r = await go(s, { roles: ["developer", "pic"] }, { requireCodex: true });
    expect(r.status).toBe("failed");
    expect(r.message).toContain("pic");
    expect(s.calls).toHaveLength(0);
  });

  it("ignores requireCodex when no role needs a capability", async () => {
    const s = setup({}, { readiness: NOT_READY });
    const r = await go(s, { team: "quick" }, { requireCodex: true });
    expect(r.status).toBe("ok");
  });
});

describe("runRoles: dry run and rejections", () => {
  it("returns the plan without running or writing anything", async () => {
    const s = setup({}, { readiness: NOT_READY });
    const r = await go(s, { roles: ["developer", "pic", "reviewer"] }, { dryRun: true });
    expect(r.status).toBe("planned");
    expect(r.plan!.map((p) => [p.role, p.agent])).toEqual([["developer", "claude"], ["pic", "codex"], ["reviewer", "claude"]]);
    expect(r.plan![1].skipReason).toContain("codex login");
    expect(r.message).toContain("2 model calls");
    expect(s.calls).toHaveLength(0);
    expect(existsSync(join(s.cwd, ".orch"))).toBe(false);
  });

  it("rejects conflicting selectors and unknown names without running", async () => {
    const s = setup({});
    expect((await go(s, { role: "reviewer", team: "standard" })).status).toBe("rejected");
    const unknown = await go(s, { team: "huge" });
    expect(unknown.status).toBe("rejected");
    expect(unknown.message).toContain("standard");
    expect(s.calls).toHaveLength(0);
  });
});
