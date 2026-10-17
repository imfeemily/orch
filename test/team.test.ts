import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/core/state.js";
import type { Config, RunFn, RunResult } from "../src/core/types.js";
import { Ledger } from "../src/core/usage.js";
import type { ReadinessChecker } from "../src/core/readiness.js";
import { groupSteps, runAuto, runRoles } from "../src/core/team.js";
import { noSummaryConfig } from "./helpers/config.js";

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: "" });
const FAIL: RunResult = { exitCode: 2, stdout: "", stderr: "boom" };
const READY: ReadinessChecker = async () => ({ ready: true, reasons: [] });
const NOT_READY: ReadinessChecker = async () => ({ ready: false, reasons: ["not logged in: run `codex login`"] });

function setup(
  outputs: Record<string, RunResult | Error>,
  opts: {
    readiness?: ReadinessChecker;
    tweak?: (c: Config) => void;
    onRun?: (role: string, prompt: string, cwd: string) => void;
    delays?: Record<string, number>;
    abortOn?: string;
  } = {},
) {
  const config = noSummaryConfig();
  config.roles.pic = { prompt: "You are the picture maker.", needs: ["image"], writes: false };
  opts.tweak?.(config);
  const calls: { command: string; prompt: string; role: string }[] = [];
  const cwdRef = { value: "" };
  let abort: (() => void) | undefined;
  let inFlight = 0;
  let maxInFlight = 0;
  const events: string[] = [];
  const run: RunFn = async (command, _args, prompt) => {
    const role = Object.keys(config.roles).find((r) => prompt.includes(config.roles[r].prompt)) ?? "?";
    calls.push({ command, prompt, role });
    opts.onRun?.(role, prompt, cwdRef.value);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    events.push(`start:${role}`);
    const delay = opts.delays?.[role];
    if (delay) await new Promise((r) => setTimeout(r, delay));
    inFlight--;
    events.push(`end:${role}`);
    const r = outputs[role] ?? ok(`${role} output\n## Handoff\n${role} handoff`);
    if (r instanceof Error) {
      inFlight--;
      throw r;
    }
    if (role === "developer") abort?.();
    if (opts.abortOn && role === opts.abortOn) ac.abort();
    return r;
  };
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const cwd = join(dir, "project");
  mkdirSync(cwd);
  cwdRef.value = cwd;
  const state = new StateStore(join(dir, "s.json"));
  const ledger = new Ledger(join(dir, "usage.jsonl"));
  const ac = new AbortController();
  return {
    calls, cwd, ledger, config, signal: ac.signal, events, maxInFlight: () => maxInFlight, abortAfterDeveloper: () => (abort = () => ac.abort()),
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

const assetsOf = (prompt: string) => /(\.orch\/runs\/[a-z0-9-]+\/assets)/.exec(prompt)?.[1];

describe("runRoles: image roles and assets", () => {
  const writeImage = (role: string, prompt: string, cwd: string) => {
    const rel = assetsOf(prompt);
    if (role === "pic" && rel) writeFileSync(join(cwd, rel, "mockup.png"), "png-bytes");
  };

  it("creates the assets directory, names it in the prompt and reports the files the role left", async () => {
    const s = setup({}, { onRun: writeImage });
    const r = await go(s, { roles: ["developer", "pic"] });
    const pic = s.calls.find((c) => c.role === "pic")!;
    expect(pic.prompt).toContain("## Assets directory");
    expect(assetsOf(pic.prompt)).toMatch(/^\.orch\/runs\/[a-z0-9-]+\/assets$/);
    expect(r.roles![1].assets!.map((p) => p.split("/").pop())).toEqual(["mockup.png"]);
    expect(s.calls.find((c) => c.role === "developer")!.prompt).not.toContain("## Assets directory");
    expect(r.roles![0].assets).toBeUndefined();
  });

  it("reports an empty list when the role left no files, and never invents files from its text", async () => {
    const s = setup({ pic: ok("I saved /tmp/fake.png\n## Handoff\ndone") });
    const r = await go(s, { roles: ["pic"] });
    expect(r.roles![0].assets).toEqual([]);
  });

  it("does the same for a single image role", async () => {
    const s = setup({}, { onRun: writeImage });
    const r = await go(s, { role: "pic" });
    expect(assetsOf(s.calls[0].prompt)).toBeDefined();
    expect(r.assets!.map((p) => p.split("/").pop())).toEqual(["mockup.png"]);
  });

  it("skips an image role when the context preset disables image generation, in the plan and at run time", async () => {
    const s = setup({});
    const dry = await go(s, { roles: ["pic"] }, { dryRun: true, context: "minimal" });
    expect(dry.plan![0].skipReason).toContain("context preset disables image generation");
    const run = await go(s, { roles: ["developer", "pic"] }, { context: "minimal" });
    expect(run.roles![1]).toMatchObject({ role: "pic", status: "skipped" });
    expect(run.roles![1].reason).toContain("disables image generation");
    expect(s.calls.map((c) => c.role)).toEqual(["developer"]);
  });
});

describe("runRoles: robustness", () => {
  const tweak = (c: Config) => {
    c.teams.par = ["developer", "reviewer", "security"];
  };

  it("creates the artifacts folder's .gitignore before the first role runs", async () => {
    let existed: boolean[] = [];
    const s = setup({}, { onRun: (_r, _p, cwd) => { existed.push(existsSync(join(cwd, ".orch", "runs", ".gitignore"))); } });
    await go(s, { team: "standard" });
    expect(existed).toEqual([true, true, true]);
  });

  it("does not write an artifact for a role that produced no output", async () => {
    const s = setup({ developer: FAIL });
    const r = await go(s, { team: "standard" });
    expect(r.roles![0].status).toBe("failed");
    expect(r.roles![0].artifact).toBeUndefined();
  });

  it("rejects an unknown context up front, in a run and in a dry run", async () => {
    const s = setup({});
    for (const extra of [{ context: "nope" }, { context: "nope", dryRun: true }]) {
      const r = await go(s, { team: "standard" }, extra);
      expect(r.status).toBe("rejected");
      expect(r.message).toContain("nope");
      expect(r.message).toContain("lean");
    }
    expect(s.calls).toHaveLength(0);
  });

  it("keeps a failing role from losing its sibling's result when a call throws", async () => {
    const s = setup({ reviewer: new Error("disk full") }, { tweak, delays: { security: 20 } });
    const r = await go(s, { team: "par" });
    expect(r.roles!.map((x) => [x.role, x.status])).toEqual([["developer", "ok"], ["reviewer", "failed"], ["security", "ok"]]);
    expect(r.roles![1].reason).toContain("disk full");
    expect(r.status).toBe("failed");
  });

  it("with sequential, a role skipped at plan time after a failure is not-run, as before; in parallel mode it stays skipped", async () => {
    const readiness: ReadinessChecker = async (agent) => (agent === "codex" ? { ready: false, reasons: ["not logged in"] } : { ready: true, reasons: [] });
    const seq = setup({ developer: FAIL }, { readiness });
    const rs = await go(seq, { roles: ["developer", "pic", "reviewer"] }, { sequential: true });
    expect(rs.roles!.map((x) => [x.role, x.status])).toEqual([["developer", "failed"], ["pic", "not-run"], ["reviewer", "not-run"]]);
    const par = setup({ developer: FAIL }, { readiness });
    const rp = await go(par, { roles: ["developer", "pic", "reviewer"] });
    expect(rp.roles!.map((x) => [x.role, x.status])).toEqual([["developer", "failed"], ["pic", "skipped"], ["reviewer", "not-run"]]);
  });
});

describe("groupSteps", () => {
  const step = (role: string) => ({ role, agent: "claude" as const });
  const withRoles = (extra: Record<string, boolean>, maxParallel = 2) => {
    const c = noSummaryConfig();
    for (const [name, writes] of Object.entries(extra)) c.roles[name] = { prompt: name, needs: [], writes };
    c.pipeline.maxParallel = maxParallel;
    return c;
  };

  it("keeps writers alone and batches adjacent read-only roles", () => {
    const c = noSummaryConfig();
    const g = groupSteps(["developer", "tester", "reviewer", "security"].map(step), c, true);
    expect(g.map((x) => x.map((s) => s.role))).toEqual([["developer"], ["tester"], ["reviewer", "security"]]);
  });

  it("never batches across a writer", () => {
    const g = groupSteps(["reviewer", "developer", "security"].map(step), noSummaryConfig(), true);
    expect(g.map((x) => x.length)).toEqual([1, 1, 1]);
  });

  it("is all single groups when parallel is off or maxParallel is 1", () => {
    const names = ["reviewer", "security"].map(step);
    expect(groupSteps(names, noSummaryConfig(), false).map((x) => x.length)).toEqual([1, 1]);
    expect(groupSteps(names, withRoles({}, 1), true).map((x) => x.length)).toEqual([1, 1]);
  });

  it("splits a long run of read-only roles into batches of maxParallel", () => {
    const c = withRoles({ a: false, b: false });
    const g = groupSteps(["reviewer", "security", "a", "b"].map(step), c, true);
    expect(g.map((x) => x.map((s) => s.role))).toEqual([["reviewer", "security"], ["a", "b"]]);
    const c3 = withRoles({ a: false }, 2);
    expect(groupSteps(["reviewer", "security", "a"].map(step), c3, true).map((x) => x.length)).toEqual([2, 1]);
  });
});

describe("runRoles: parallel read-only roles", () => {
  const tweak = (c: Config) => {
    c.teams.par = ["developer", "reviewer", "security"];
    c.roles.extra = { prompt: "You are the extra role.", needs: [], writes: true };
    c.teams.after = ["reviewer", "security", "extra"];
  };

  it("runs reviewer and security at the same time, but never together with the developer", async () => {
    const s = setup({}, { tweak, delays: { developer: 20, reviewer: 40, security: 40 } });
    const r = await go(s, { team: "par" });
    expect(r.status).toBe("ok");
    expect(s.maxInFlight()).toBe(2);
    const at = (e: string) => s.events.indexOf(e);
    expect(at("end:developer")).toBeLessThan(at("start:reviewer"));
    expect(at("start:security")).toBeLessThan(at("end:reviewer"));
  });

  it("reports results, outputs and artifacts in plan order whichever call finishes first", async () => {
    const s = setup({}, { tweak, delays: { reviewer: 80, security: 5 } });
    const r = await go(s, { team: "par" });
    expect(s.events.indexOf("end:security")).toBeLessThan(s.events.indexOf("end:reviewer"));
    expect(r.roles!.map((x) => x.role)).toEqual(["developer", "reviewer", "security"]);
    expect(r.output.indexOf("## reviewer")).toBeLessThan(r.output.indexOf("## security"));
    for (const x of r.roles!) expect(readFileSync(x.artifact!, "utf8")).toContain(`${x.role} output`);
  });

  it("gives both roles of a batch the same earlier handoffs and never each other's", async () => {
    const s = setup({}, { tweak, delays: { reviewer: 30, security: 30 } });
    await go(s, { team: "par" });
    const rev = s.calls.find((c) => c.role === "reviewer")!.prompt;
    const sec = s.calls.find((c) => c.role === "security")!.prompt;
    expect(rev).toContain("### developer");
    expect(sec).toContain("### developer");
    expect(rev).not.toContain("### security");
    expect(sec).not.toContain("### reviewer");
  });

  it("lets the sibling finish when one role of a batch fails, then stops the team", async () => {
    const s = setup({ security: FAIL }, { tweak, delays: { reviewer: 40, security: 5 } });
    const r = await go(s, { team: "after" });
    expect(r.status).toBe("failed");
    expect(r.roles!.map((x) => [x.role, x.status])).toEqual([["reviewer", "ok"], ["security", "failed"], ["extra", "not-run"]]);
    expect(s.calls.some((c) => c.role === "reviewer")).toBe(true);
  });

  it("runs the next role after a failed batch when keepGoing is set", async () => {
    const s = setup({ security: FAIL }, { tweak });
    const r = await go(s, { team: "after" }, { keepGoing: true });
    expect(r.roles!.map((x) => x.status)).toEqual(["ok", "failed", "ok"]);
  });

  it("is sequential with --sequential and with pipeline.parallel false, with the same results", async () => {
    const a = setup({}, { tweak, delays: { reviewer: 20, security: 20 } });
    const ra = await go(a, { team: "par" }, { sequential: true });
    expect(a.maxInFlight()).toBe(1);
    const b = setup({}, { tweak: (c) => { tweak(c); c.pipeline.parallel = false; }, delays: { reviewer: 20, security: 20 } });
    const rb = await go(b, { team: "par" });
    expect(b.maxInFlight()).toBe(1);
    expect(ra.roles!.map((x) => x.status)).toEqual(rb.roles!.map((x) => x.status));
  });

  it("does not let a skipped role take a parallel slot", async () => {
    const readiness: ReadinessChecker = async (agent) => (agent === "codex" ? { ready: false, reasons: ["not logged in"] } : { ready: true, reasons: [] });
    const s = setup({}, { readiness, delays: { reviewer: 40, security: 40 } });
    const r = await go(s, { roles: ["pic", "reviewer", "security"] });
    expect(r.roles!.find((x) => x.role === "pic")!.status).toBe("skipped");
    expect(s.maxInFlight()).toBe(2);
  });

  it("cancels the roles after a batch when aborted during it", async () => {
    const s = setup({}, { tweak, delays: { reviewer: 10, security: 40 }, abortOn: "reviewer" });
    const r = await go(s, { team: "after" }, { signal: s.signal });
    expect(r.roles!.map((x) => x.status)).toEqual(["ok", "ok", "not-run"]);
    expect(r.roles![2].reason).toBe("cancelled");
    expect(r.status).toBe("failed");
    expect(r.message).toContain("aborted");
  });

  it("marks batch members with a shared group number in a dry run, and none when sequential", async () => {
    const s = setup({}, { tweak });
    const dry = await go(s, { team: "par" }, { dryRun: true });
    const g = Object.fromEntries(dry.plan!.map((p) => [p.role, p.group]));
    expect(g.developer).toBeUndefined();
    expect(g.reviewer).toBeDefined();
    expect(g.reviewer).toBe(g.security);
    const seq = await go(s, { team: "par" }, { dryRun: true, sequential: true });
    expect(seq.plan!.every((p) => p.group === undefined)).toBe(true);
  });
});

describe("runAuto", () => {
  const auto = (s: S, task: string, extra: object = {}) => runAuto(s.deps, { task, cwd: s.cwd, depth: 0, ...extra });

  it("runs the selected roles like a team and reports the selection", async () => {
    const s = setup({});
    const r = await auto(s, "fix the typo in README");
    expect(s.calls.map((c) => c.role)).toEqual(["developer", "tester"]);
    expect(r.status).toBe("ok");
    expect(r.selection!.roles).toEqual(["developer", "tester"]);
    expect(r.selection!.reasons.join(" ")).toContain("fix");
  });

  it("runs a question as one plain call with no roles", async () => {
    const s = setup({});
    const r = await auto(s, "explain how the router picks an agent");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].prompt).toBe("explain how the router picks an agent");
    expect(r.selection!.roles).toEqual([]);
    expect(existsSync(join(s.cwd, ".orch"))).toBe(false);
  });

  it("respects auto.maxRoles and reports the dropped roles", async () => {
    const s = setup({}, { tweak: (c) => (c.auto.maxRoles = 1) });
    const r = await auto(s, "fix the typo in README");
    expect(s.calls.map((c) => c.role)).toEqual(["developer"]);
    expect(r.selection!.dropped).toEqual(["tester"]);
  });

  it("plans without running on a dry run", async () => {
    const s = setup({});
    const r = await auto(s, "fix the typo in README", { dryRun: true });
    expect(r.status).toBe("planned");
    expect(r.plan!.map((p) => p.role)).toEqual(["developer", "tester"]);
    expect(r.selection!.roles).toEqual(["developer", "tester"]);
    expect(s.calls).toHaveLength(0);
    const q = await auto(s, "what does clamp do", { dryRun: true });
    expect(q.status).toBe("planned");
    expect(q.message).toContain("plain");
  });

  it("says in the selection when a question made --require-codex and --keep-going moot", async () => {
    const s = setup({});
    const r = await auto(s, "what does clamp do", { requireCodex: true, keepGoing: true });
    expect(r.selection!.reasons.join(" ")).toMatch(/--require-codex.*--keep-going.*ignored/);
    const quiet = await auto(setup({}), "what does clamp do");
    expect(quiet.selection!.reasons.join(" ")).not.toContain("ignored");
  });

  it("rejects an explicit selector and allows role-only flags", async () => {
    const s = setup({});
    const bad = await auto(s, "fix it", { team: "standard" });
    expect(bad.status).toBe("rejected");
    expect(bad.message).toContain("--auto");
    expect(bad.message).toContain("--team");
    const ok2 = await auto(s, "fix the typo in README", { requireCodex: true, keepGoing: true });
    expect(ok2.status).toBe("ok");
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

describe("runRoles: readiness is rechecked before each role", () => {
  it("skips a role whose agent stopped being ready after the plan was made, instead of failing the team", async () => {
    let calls = 0;
    const flipping: ReadinessChecker = async () => (++calls <= 1 ? { ready: true, reasons: [] } : { ready: false, reasons: ["cooling down"] });
    const s = setup({}, { readiness: flipping });
    const r = await go(s, { roles: ["developer", "pic"] });
    expect(r.status).toBe("ok");
    expect(r.roles!.map((x) => [x.role, x.status])).toEqual([["developer", "ok"], ["pic", "skipped"]]);
    expect(r.roles![1].reason).toContain("cooling down");
    expect(s.calls.map((c) => c.role)).toEqual(["developer"]);
  });
});

describe("runRoles: role-only flags need a selector", () => {
  it("rejects --dry-run, --require-codex and --keep-going without --role, --roles or --team, naming the flag", async () => {
    const s = setup({});
    for (const [extra, flag] of [[{ dryRun: true }, "--dry-run"], [{ requireCodex: true }, "--require-codex"], [{ keepGoing: true }, "--keep-going"]] as const) {
      const r = await go(s, {}, extra);
      expect(r.status).toBe("rejected");
      expect(r.message).toContain(flag);
      expect(r.message).toContain("--role");
    }
    expect(s.calls).toHaveLength(0);
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
