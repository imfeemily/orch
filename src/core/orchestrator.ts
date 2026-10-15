import { classify } from "./detector.js";
import { buildHandoff } from "./handoff.js";
import { otherAgent, pickAgent } from "./router.js";
import type { StateStore } from "./state.js";
import type { AgentName, Attempt, Config, RunFn, TaskResult } from "./types.js";

export interface Deps {
  config: Config;
  state: StateStore;
  run: RunFn;
  now?: () => number;
}

export interface TaskRequest {
  prompt: string;
  cwd: string;
  depth: number;
  onChunk?: (text: string) => void;
}

const SUMMARY_PROMPT =
  "In under 200 words, summarize what you completed so far and what remains for the task you were working on.";
const SUMMARY_TIMEOUT_MS = 60_000;

async function requestSummary(
  deps: Deps,
  agent: AgentName,
  req: TaskRequest,
): Promise<string | undefined> {
  const cfg = deps.config.agents[agent];
  if (!cfg.summaryArgs) return undefined;
  const r = await deps.run(cfg.command, cfg.summaryArgs, SUMMARY_PROMPT, {
    cwd: req.cwd,
    depth: req.depth,
    timeoutMs: SUMMARY_TIMEOUT_MS,
  });
  const text = r.stdout.trim();
  return r.exitCode === 0 && text ? text : undefined;
}

export async function runTask(deps: Deps, req: TaskRequest): Promise<TaskResult> {
  const { config, state, run } = deps;
  const now = deps.now ?? Date.now;
  const cooling = (a: AgentName) => state.isCooling(a, now());
  const describeCooldowns = () =>
    (["claude", "codex"] as AgentName[])
      .map((a) =>
        cooling(a)
          ? `${a}: ${Math.ceil((state.cooldownUntil(a) - now()) / 60000)}m left`
          : `${a}: available`,
      )
      .join(", ");

  const record = (res: TaskResult): TaskResult => {
    state.appendJob({
      at: now(),
      agent: res.agent,
      status: res.status,
      failedOver: res.failedOver,
      promptPreview: req.prompt.slice(0, 80),
    });
    return res;
  };

  if (req.depth >= 1) {
    return {
      status: "rejected",
      agent: null,
      output: "",
      failedOver: false,
      attempts: [],
      message: "orch was called from inside an orch-spawned agent (ORCH_DEPTH >= 1); refusing to recurse",
    };
  }

  const first = pickAgent(config, req.prompt, cooling);
  if (!first) {
    return record({
      status: "unavailable",
      agent: null,
      output: "",
      failedOver: false,
      attempts: [],
      message: `Both agents are cooling down (${describeCooldowns()})`,
    });
  }

  const runAttempt = async (agent: AgentName, prompt: string) => {
    const cfg = config.agents[agent];
    const result = await run(cfg.command, cfg.args, prompt, {
      cwd: req.cwd,
      depth: req.depth,
      onChunk: req.onChunk,
    });
    // CLIs such as codex echo the prompt; remove it so our own handoff wording
    // ("hit a usage/rate limit") is never mistaken for a limit error.
    const scrub = (s: string) => s.split(prompt).join("");
    const outcome = classify(
      { ...result, stdout: scrub(result.stdout), stderr: scrub(result.stderr) },
      cfg.limitPatterns,
    );
    if (outcome === "limited") state.setCooldown(agent, now() + cfg.defaultCooldownSec * 1000);
    const attempt: Attempt = { agent, outcome, exitCode: result.exitCode, stderr: result.stderr };
    return { result, outcome, attempt };
  };

  const a1 = await runAttempt(first, req.prompt);
  if (a1.outcome === "ok") {
    return record({
      status: "ok",
      agent: first,
      output: a1.result.stdout,
      failedOver: false,
      attempts: [a1.attempt],
    });
  }

  const second = otherAgent(first);
  if (cooling(second)) {
    return record({
      status: "failed",
      agent: first,
      output: a1.result.stdout,
      failedOver: false,
      attempts: [a1.attempt],
      message: `${first} ${a1.outcome}; ${second} unavailable (${describeCooldowns()})`,
    });
  }

  const summary = await requestSummary(deps, first, req);
  const handoff = await buildHandoff({
    prompt: req.prompt,
    cwd: req.cwd,
    previousAgent: first,
    reason: a1.outcome,
    summary,
  });
  const a2 = await runAttempt(second, handoff);
  return record({
    status: a2.outcome === "ok" ? "ok" : "failed",
    agent: second,
    output: a2.result.stdout,
    failedOver: true,
    attempts: [a1.attempt, a2.attempt],
    message:
      a2.outcome === "ok"
        ? undefined
        : `${first} ${a1.outcome}, then ${second} ${a2.outcome}: ${a2.result.stderr.trim().slice(0, 300)}`,
  });
}
