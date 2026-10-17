import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Deps, runTask } from "./orchestrator.js";
import { type ReadinessChecker, contextBlocks } from "./readiness.js";
import { type Handoff, type RoleSelection, buildRolePrompt, capHandoffs, extractHandoff, planRoles } from "./roles.js";
import { pickRoleRoute } from "./router.js";
import { selectRoles } from "./select-roles.js";
import type { AgentName, Config, PlanStep, RoleConfig, RoleResult, TaskResult } from "./types.js";
import { sumUsage } from "./usage.js";

export interface TeamDeps extends Deps {
  readiness: ReadinessChecker;
}

export interface TeamRequest extends RoleSelection {
  task: string;
  cwd: string;
  depth: number;
  context?: string;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  /** one line when a role of a team starts or finishes */
  onProgress?: (text: string) => void;
  dryRun?: boolean;
  requireCodex?: boolean;
  keepGoing?: boolean;
  auto?: boolean;
  /** run one role at a time even when read-only roles could overlap */
  sequential?: boolean;
}

/** Files (not directories, not dotfiles) an image role left in its assets directory. */
function listAssets(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((f) => {
      if (f.startsWith(".")) return false;
      try {
        return lstatSync(join(dir, f)).isFile();
      } catch {
        return false;
      }
    })
    .sort()
    .map((f) => join(dir, f));
}

/** Why the flags a role would run with (agent base flags, its own, its context preset) block a capability. */
function flagsBlock(config: Config, role: RoleConfig, agent: AgentName, context: string | undefined): string | undefined {
  if (role.needs.length === 0) return undefined;
  // The real command line is base args, then the preset's, then the role's: judge them in that order, last flag wins.
  const lists: [string[] | undefined, string][] = [
    [config.agents[agent].args, "the agent's flags"],
    [config.contexts[context ?? role.context ?? ""]?.[agent], "context preset"],
    [role.agentArgs?.[agent], "the role's flags"],
  ];
  const all = lists.flatMap(([a]) => a ?? []);
  if (!contextBlocks(all, role.needs)) return undefined;
  const source = [...lists].reverse().find(([a, label]) => contextBlocks(a, role.needs, label));
  return contextBlocks(all, role.needs, source?.[1] ?? "the flags");
}

/**
 * Batches of steps that run together: adjacent read-only roles, at most `pipeline.maxParallel`
 * per batch. A role that writes always runs alone.
 */
export function groupSteps(steps: PlanStep[], config: Config, parallel: boolean): PlanStep[][] {
  const readOnly = (s: PlanStep) => config.roles[s.role].writes === false;
  const groups: PlanStep[][] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (parallel && readOnly(step) && last && last.every(readOnly) && last.length < config.pipeline.maxParallel) {
      last.push(step);
    } else {
      groups.push([step]);
    }
  }
  return groups;
}

const rejected = (message: string): TaskResult => ({
  status: "rejected",
  agent: null,
  output: "",
  failedOver: false,
  attempts: [],
  message,
});

/** The assets directory of a run, created by orch for roles that need a capability. */
function prepareAssets(cwd: string, runId: string, role: string, needed: boolean): { rel: string; abs: string } | undefined {
  if (!needed) return undefined;
  const rel = join(".orch", "runs", runId, "assets", role);
  const abs = join(cwd, rel);
  try {
    mkdirSync(abs, { recursive: true });
  } catch {
    /* the role is still told where to save; listing will be empty */
  }
  return { rel, abs };
}

/** Keeps .orch/runs out of git from the first moment, so a role that runs while another writes assets does not see them as new files. */
function ensureRunsIgnore(cwd: string): void {
  try {
    const runs = join(cwd, ".orch", "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, ".gitignore"), "*\n", { flag: "wx" });
  } catch {
    /* already there, or not writable: roles still run */
  }
}

/** Saves a role's full answer under .orch/runs/<id>/; any filesystem problem just means no artifact. */
function writeArtifact(cwd: string, runId: string, role: string, output: string): string | undefined {
  if (output === "") return undefined;
  try {
    const runs = join(cwd, ".orch", "runs");
    const dir = join(runs, runId);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(runs, ".gitignore"), "*\n", { flag: "wx" });
    } catch {
      /* already there */
    }
    const file = join(dir, `${role}.md`);
    writeFileSync(file, output);
    return file;
  } catch {
    return undefined;
  }
}

/**
 * Runs one role, a team or an explicit list of roles. Each role is an ordinary runTask with the
 * role applied; roles run one after another and later roles see earlier roles' short handoffs.
 */
export async function runRoles(deps: TeamDeps, req: TeamRequest): Promise<TaskResult> {
  const { config } = deps;
  if (req.context !== undefined && !Object.hasOwn(config.contexts, req.context)) {
    return rejected(`unknown context "${req.context}"; available: ${Object.keys(config.contexts).join(", ") || "(none)"}`);
  }
  const noSelector = req.role === undefined && req.roles === undefined && req.team === undefined;
  if (noSelector) {
    const flags = [req.dryRun && "--dry-run", req.requireCodex && "--require-codex", req.keepGoing && "--keep-going", req.sequential && "--sequential"].filter(Boolean);
    if (flags.length > 0) return rejected(`${flags.join(", ")} ${flags.length > 1 ? "need" : "needs"} --role, --roles or --team`);
  }
  const planned = planRoles(config, req);
  if ("error" in planned) return rejected(planned.error);
  const names = planned.names;
  const single = req.role !== undefined;

  // Which agent each role would use, and whether a role that needs a capability can run.
  const steps: PlanStep[] = [];
  for (const name of names) {
    const role = config.roles[name];
    const agent = pickRoleRoute(config, role, req.task, () => false)?.agent ?? null;
    const step: PlanStep = { role: name, agent };
    if (role.needs.length > 0 && agent) {
      const blocked = flagsBlock(config, role, agent, req.context);
      if (blocked) {
        step.skipReason = blocked;
      } else {
        const r = await deps.readiness(agent, role.needs);
        if (!r.ready) step.skipReason = r.reasons.join("; ");
      }
    }
    steps.push(step);
  }

  const blocked = steps.filter((s) => s.skipReason);
  if (req.requireCodex && blocked.length > 0 && !req.dryRun) {
    const why = blocked.map((s) => `role "${s.role}": ${s.skipReason}`).join("; ");
    return { ...rejected(`codex is required but not ready (${why})`), status: "failed" };
  }

  const parallelOn = config.pipeline.parallel && !req.sequential && !single;
  if (req.dryRun) {
    let n = 0;
    for (const g of groupSteps(steps.filter((s) => !s.skipReason), config, parallelOn)) {
      if (g.length > 1) {
        n += 1;
        for (const s of g) s.group = n;
      }
    }
    const calls = steps.filter((s) => !s.skipReason).length;
    return {
      status: "planned",
      agent: null,
      output: "",
      failedOver: false,
      attempts: [],
      plan: steps,
      message: `${calls} model call${calls === 1 ? "" : "s"} planned${blocked.length ? `, ${blocked.length} skipped` : ""}`,
    };
  }

  const runId = randomUUID().slice(0, 8);

  if (single) {
    const step = steps[0];
    if (step.skipReason) {
      return { ...rejected(`role "${step.role}" cannot run: ${step.skipReason}`), status: "failed" };
    }
    const role = config.roles[step.role];
    if (role.needs.length > 0) ensureRunsIgnore(req.cwd);
    const assets = prepareAssets(req.cwd, runId, step.role, role.needs.length > 0);
    const prompt = buildRolePrompt(role, req.task, [], false, assets?.rel);
    const result = await runTask(deps, {
      prompt,
      cwd: req.cwd,
      depth: req.depth,
      role: step.role,
      runId,
      context: req.context,
      signal: req.signal,
      onChunk: req.onChunk,
    });
    return assets ? { ...result, assets: listAssets(assets.abs) } : result;
  }

  ensureRunsIgnore(req.cwd);
  const results: RoleResult[] = [];
  const outputsByRole = new Map<string, string>();
  const attempts: TaskResult["attempts"] = [];
  const handoffs: Handoff[] = [];
  let failed = false;
  let aborted = false;
  let failedOver = false;
  let lastAgent: AgentName | null = null;
  const messages: string[] = [];

  // In parallel mode, roles skipped when the plan was made take no place in any batch and are recorded
  // up front. One at a time, they stay in plan order so an earlier failure or abort marks them not-run.
  for (const step of parallelOn ? steps.filter((s) => s.skipReason) : []) {
    results.push({ role: step.role, agent: step.agent, status: "skipped", reason: step.skipReason });
    messages.push(`role "${step.role}" skipped: ${step.skipReason}`);
  }

  for (const group of groupSteps(parallelOn ? steps.filter((s) => !s.skipReason) : steps, config, parallelOn)) {
    if (req.signal?.aborted) aborted = true;
    if (aborted) {
      for (const step of group) results.push({ role: step.role, agent: step.agent, status: "not-run", reason: "cancelled" });
      continue;
    }
    if (failed && !req.keepGoing) {
      for (const step of group) results.push({ role: step.role, agent: step.agent, status: "not-run", reason: "an earlier role failed" });
      continue;
    }

    // An earlier role may have hit a rate limit since the plan was made: check again, do not fail.
    const toRun: PlanStep[] = [];
    for (const step of group) {
      const role = config.roles[step.role];
      if (role.needs.length > 0 && step.agent) {
        const blocked = flagsBlock(config, role, step.agent, req.context);
        if (blocked) {
          step.skipReason = blocked;
        } else {
          const now = await deps.readiness(step.agent, role.needs);
          if (!now.ready) step.skipReason = now.reasons.join("; ");
        }
      }
      if (step.skipReason) {
        results.push({ role: step.role, agent: step.agent, status: "skipped", reason: step.skipReason });
        messages.push(`role "${step.role}" skipped: ${step.skipReason}`);
      } else {
        toRun.push(step);
      }
    }

    // Every role of a batch starts from the same handoffs and never sees its siblings'.
    const snapshot = capHandoffs(handoffs, config.pipeline.handoffChars);
    const done = await Promise.all(
      toRun.map(async (step) => {
        const role = config.roles[step.role];
        req.onProgress?.(`${step.role}: started (${step.agent ?? "-"})`);
        const assets = prepareAssets(req.cwd, runId, step.role, role.needs.length > 0);
        const prompt = buildRolePrompt(role, req.task, snapshot, true, assets?.rel);
        let r: TaskResult;
        try {
          r = await runTask(deps, {
            prompt,
            cwd: req.cwd,
            depth: req.depth,
            role: step.role,
            runId,
            context: req.context,
            signal: req.signal,
          });
        } catch (e) {
          // a call that throws fails its role; it must not take its siblings' results with it
          r = { status: "failed", agent: step.agent, output: "", failedOver: false, attempts: [], message: e instanceof Error ? e.message : String(e) };
        }
        req.onProgress?.(`${step.role}: ${r.status}`);
        return { step, assets, r };
      }),
    );

    for (const { step, assets, r } of done) {
      attempts.push(...r.attempts);
      failedOver ||= r.failedOver;
      lastAgent = r.agent ?? lastAgent;
      const artifact = writeArtifact(req.cwd, runId, step.role, r.output);
      const listed = assets ? { assets: listAssets(assets.abs) } : {};
      if (r.status === "ok") {
        handoffs.push({ role: step.role, text: extractHandoff(r.output) });
        results.push({ role: step.role, agent: r.agent, status: "ok", artifact, usage: r.usage, ...listed });
      } else {
        failed = true;
        results.push({ role: step.role, agent: r.agent, status: "failed", reason: r.message ?? r.status, artifact, usage: r.usage, ...listed });
        messages.push(`role "${step.role}" ${r.status}: ${r.message ?? ""}`.trim());
      }
      if (r.output) outputsByRole.set(step.role, `## ${step.role}\n${r.output}`);
    }
    if (req.signal?.aborted) aborted = true;
  }

  // Report everything in plan order, whichever call finished first.
  const order = new Map(steps.map((s, i) => [s.role, i]));
  results.sort((x, y) => (order.get(x.role) ?? 0) - (order.get(y.role) ?? 0));
  const outputs = steps.map((s) => outputsByRole.get(s.role)).filter((o): o is string => o !== undefined);

  const anyOk = results.some((x) => x.status === "ok");
  const status = !failed && !aborted && anyOk ? "ok" : "failed";
  if (aborted) messages.push("aborted by caller");
  return {
    status,
    agent: lastAgent,
    output: outputs.join("\n\n"),
    failedOver,
    attempts,
    roles: results,
    usage: sumUsage(results.map((x) => x.usage)),
    ...(messages.length ? { message: messages.join(" | ") } : {}),
  };
}

/**
 * Automatic mode: pick roles from the prompt with `selectRoles`, run them as a team, and attach the
 * selection. A prompt that selects no roles (a question) runs as one plain call.
 */
export async function runAuto(deps: TeamDeps, req: TeamRequest): Promise<TaskResult> {
  const given = [req.role !== undefined && "--role", req.roles !== undefined && "--roles", req.team !== undefined && "--team"].filter(Boolean);
  if (given.length > 0) return rejected(`--auto cannot be combined with ${given.join(" or ")}`);

  const sel = selectRoles(deps.config, req.task);
  const selection = { roles: sel.roles, reasons: sel.reasons, dropped: sel.dropped };

  if (sel.roles.length === 0) {
    const moot = [req.requireCodex && "--require-codex", req.keepGoing && "--keep-going", req.sequential && "--sequential"].filter(Boolean);
    if (moot.length > 0) selection.reasons.push(`${moot.join(", ")} ignored: no roles were selected`);
    if (req.dryRun) {
      return {
        status: "planned",
        agent: null,
        output: "",
        failedOver: false,
        attempts: [],
        plan: [],
        message: "1 model call planned (plain call, no roles)",
        selection,
      };
    }
    const plain = await runTask(deps, {
      prompt: req.task,
      cwd: req.cwd,
      depth: req.depth,
      context: req.context,
      signal: req.signal,
      onChunk: req.onChunk,
    });
    return { ...plain, selection };
  }

  const result = await runRoles(deps, { ...req, auto: undefined, roles: sel.roles });
  return { ...result, selection };
}
