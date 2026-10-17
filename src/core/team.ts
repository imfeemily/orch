import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Deps, runTask } from "./orchestrator.js";
import type { ReadinessChecker } from "./readiness.js";
import { type Handoff, type RoleSelection, buildRolePrompt, capHandoffs, extractHandoff, planRoles } from "./roles.js";
import { pickRoleRoute } from "./router.js";
import type { AgentName, PlanStep, RoleResult, TaskResult, Usage } from "./types.js";

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
  dryRun?: boolean;
  requireCodex?: boolean;
  keepGoing?: boolean;
}

const rejected = (message: string): TaskResult => ({
  status: "rejected",
  agent: null,
  output: "",
  failedOver: false,
  attempts: [],
  message,
});

function sumUsage(usages: Array<Usage | undefined>): Usage | undefined {
  const present = usages.filter((u): u is Usage => u !== undefined);
  if (present.length === 0) return undefined;
  return present.reduce<Usage>(
    (a, u) => ({
      inputTokens: a.inputTokens + u.inputTokens,
      cacheReadTokens: a.cacheReadTokens + u.cacheReadTokens,
      outputTokens: a.outputTokens + u.outputTokens,
      ...(a.costUsd !== undefined || u.costUsd !== undefined ? { costUsd: (a.costUsd ?? 0) + (u.costUsd ?? 0) } : {}),
    }),
    { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  );
}

/** Saves a role's full answer under .orch/runs/<id>/; any filesystem problem just means no artifact. */
function writeArtifact(cwd: string, runId: string, role: string, output: string): string | undefined {
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
      const r = await deps.readiness(agent, role.needs);
      if (!r.ready) step.skipReason = r.reasons.join("; ");
    }
    steps.push(step);
  }

  const blocked = steps.filter((s) => s.skipReason);
  if (req.requireCodex && blocked.length > 0 && !req.dryRun) {
    const why = blocked.map((s) => `role "${s.role}": ${s.skipReason}`).join("; ");
    return { ...rejected(`codex is required but not ready (${why})`), status: "failed" };
  }

  if (req.dryRun) {
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
    const prompt = buildRolePrompt(config.roles[step.role], req.task, [], false);
    return runTask(deps, {
      prompt,
      cwd: req.cwd,
      depth: req.depth,
      role: step.role,
      runId,
      context: req.context,
      signal: req.signal,
      onChunk: req.onChunk,
    });
  }

  const results: RoleResult[] = [];
  const outputs: string[] = [];
  const attempts: TaskResult["attempts"] = [];
  const handoffs: Handoff[] = [];
  let failed = false;
  let aborted = false;
  let failedOver = false;
  let lastAgent: AgentName | null = null;
  const messages: string[] = [];

  for (const step of steps) {
    if (req.signal?.aborted) aborted = true;
    if (aborted) {
      results.push({ role: step.role, agent: step.agent, status: "not-run", reason: "cancelled" });
      continue;
    }
    if (failed && !req.keepGoing) {
      results.push({ role: step.role, agent: step.agent, status: "not-run", reason: "an earlier role failed" });
      continue;
    }
    if (step.skipReason) {
      results.push({ role: step.role, agent: step.agent, status: "skipped", reason: step.skipReason });
      messages.push(`role "${step.role}" skipped: ${step.skipReason}`);
      continue;
    }

    const role = config.roles[step.role];
    const prompt = buildRolePrompt(role, req.task, capHandoffs(handoffs, config.pipeline.handoffChars), true);
    const r = await runTask(deps, {
      prompt,
      cwd: req.cwd,
      depth: req.depth,
      role: step.role,
      runId,
      context: req.context,
      signal: req.signal,
    });
    attempts.push(...r.attempts);
    failedOver ||= r.failedOver;
    lastAgent = r.agent ?? lastAgent;
    const artifact = writeArtifact(req.cwd, runId, step.role, r.output);
    if (r.status === "ok") {
      handoffs.push({ role: step.role, text: extractHandoff(r.output) });
      results.push({ role: step.role, agent: r.agent, status: "ok", artifact, usage: r.usage });
    } else {
      failed = true;
      results.push({ role: step.role, agent: r.agent, status: "failed", reason: r.message ?? r.status, artifact, usage: r.usage });
      messages.push(`role "${step.role}" ${r.status}: ${r.message ?? ""}`.trim());
    }
    if (r.output) outputs.push(`## ${step.role}\n${r.output}`);
    if (req.signal?.aborted) aborted = true;
  }

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
