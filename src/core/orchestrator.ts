import { randomUUID } from "node:crypto";
import { buildAgentArgs } from "./agent-args.js";
import { classify, relevantText } from "./detector.js";
import { buildHandoff } from "./handoff.js";
import { parseAgentOutput } from "./output.js";
import { parseResetTime } from "./reset.js";
import { type Route, otherAgent, pickRoleRoute, pickRoute } from "./router.js";
import type { StateStore } from "./state.js";
import type { AgentName, Attempt, Config, RunFn, TaskResult } from "./types.js";
import type { Ledger } from "./usage.js";

export interface Deps {
  config: Config;
  state: StateStore;
  run: RunFn;
  ledger?: Ledger;
  now?: () => number;
}

export interface TaskRequest {
  prompt: string;
  cwd: string;
  depth: number;
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
  /** name of a `contexts` preset; overrides the matching rule's */
  context?: string;
  /** name of a role: its agent, model, effort, context and agent args apply */
  role?: string;
  /** groups the runs of one team in the ledger (used as the task id) */
  runId?: string;
}

const LOGIN_HINT: Record<AgentName, string> = {
  claude: "run `claude`, then /login",
  codex: "run `codex login`",
};

function withAuthHints(message: string, attempts: Attempt[]): string {
  const hints = attempts
    .filter((a) => a.outcome === "auth")
    .map((a) => `${a.agent} is not logged in: ${LOGIN_HINT[a.agent]}`);
  return [message, ...hints].join(" | ");
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
  const text = parseAgentOutput(cfg.output, r.stdout).text.trim();
  return r.exitCode === 0 && text ? text : undefined;
}

/** Cooldown and job bookkeeping must never cost the user a finished answer. */
function bestEffort(fn: () => void): void {
  try {
    fn();
  } catch {
    /* ignore */
  }
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

  let contextName: string | undefined;
  const record = (res: TaskResult): TaskResult => {
    bestEffort(() => state.appendJob({
      ...(contextName ? { context: contextName } : {}),
      ...(req.role ? { role: req.role } : {}),
      ...(route?.model && res.agent === route.agent ? { model: route.model } : {}),
      at: now(),
      agent: res.agent,
      status: res.status,
      failedOver: res.failedOver,
      promptPreview: req.prompt.slice(0, 80),
    }));
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

  if (req.context !== undefined && !Object.hasOwn(config.contexts, req.context)) {
    return {
      status: "rejected",
      agent: null,
      output: "",
      failedOver: false,
      attempts: [],
      message: `unknown context "${req.context}"; available: ${Object.keys(config.contexts).join(", ") || "(none)"}`,
    };
  }

  const roleCfg = req.role !== undefined && Object.hasOwn(config.roles, req.role) ? config.roles[req.role] : undefined;
  if (req.role !== undefined && !roleCfg) {
    return {
      status: "rejected",
      agent: null,
      output: "",
      failedOver: false,
      attempts: [],
      message: `unknown role "${req.role}"; available: ${Object.keys(config.roles).join(", ") || "(none)"}`,
    };
  }

  const route = roleCfg
    ? pickRoleRoute(config, roleCfg, req.prompt, cooling)
    : pickRoute(config, req.prompt, cooling);
  if (!route) {
    const pinnedTo = roleCfg && roleCfg.needs.length > 0 ? (roleCfg.agent ?? "codex") : undefined;
    return record({
      status: "unavailable",
      agent: null,
      output: "",
      failedOver: false,
      attempts: [],
      message: pinnedTo
        ? `role "${req.role}" needs ${pinnedTo}, which is cooling down (${describeCooldowns()})`
        : `Both agents are cooling down (${describeCooldowns()})`,
    });
  }

  contextName = req.context ?? route.context;
  const first = route.agent;
  const routedModel = route.model;
  const taskId = req.runId ?? randomUUID().slice(0, 8);
  const runAttempt = async (agent: AgentName, prompt: string, choice: Route = { agent }) => {
    const cfg = config.agents[agent];
    const startedAt = now();
    const contextArgs = contextName ? config.contexts[contextName]?.[agent] : undefined;
    const roleArgs = roleCfg?.agentArgs?.[agent];
    const result = await run(cfg.command, buildAgentArgs(cfg, { ...choice, contextArgs, roleArgs }), prompt, {
      cwd: req.cwd,
      depth: req.depth,
      // JSON agents print machine output; only plain-text agents are streamed live.
      onChunk: cfg.output === "text" ? req.onChunk : undefined,
      signal: req.signal,
      ...(cfg.timeoutSec ? { timeoutMs: cfg.timeoutSec * 1000 } : {}),
    });
    const parsed = parseAgentOutput(cfg.output, result.stdout);
    // CLIs such as codex echo the prompt; remove it so our own handoff wording
    // ("hit a usage/rate limit") is never mistaken for a limit error.
    const scrub = (s: string) => s.split(prompt).join("");
    const judged = {
      exitCode: result.exitCode,
      stdout: scrub(parsed.errorText ?? parsed.text),
      stderr: scrub(result.stderr),
    };
    const outcome = classify(judged, cfg.limitPatterns, cfg.authPatterns);
    if (outcome === "limited") {
      const until = parseResetTime(relevantText(judged), now()) ?? now() + cfg.defaultCooldownSec * 1000;
      bestEffort(() => state.setCooldown(agent, until));
    }
    const model = agent === first ? routedModel : undefined;
    const attempt: Attempt = {
      agent,
      outcome,
      exitCode: result.exitCode,
      stderr: result.stderr,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
      ...(model ? { model } : {}),
    };
    deps.ledger?.append({
      at: startedAt,
      taskId,
      agent,
      ...(model ? { model } : {}),
      ...(contextName ? { context: contextName } : {}),
      ...(req.role ? { role: req.role } : {}),
      outcome,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
      durationMs: now() - startedAt,
      promptChars: req.prompt.length,
    });
    const streamed = cfg.output === "text" && req.onChunk !== undefined;
    return { text: parsed.text, detail: parsed.errorText ?? result.stderr, outcome, attempt, streamed };
  };

  const a1 = await runAttempt(first, req.prompt, route);
  if (a1.outcome === "ok") {
    return record({
      status: "ok",
      agent: first,
      output: a1.text,
      failedOver: false,
      attempts: [a1.attempt],
      usage: a1.attempt.usage,
      streamed: a1.streamed,
    });
  }

  if (req.signal?.aborted) {
    return record({
      status: "failed",
      agent: first,
      output: a1.text,
      failedOver: false,
      attempts: [a1.attempt],
      streamed: a1.streamed,
      message: "aborted by caller",
    });
  }

  if (roleCfg && roleCfg.needs.length > 0) {
    return record({
      status: "failed",
      agent: first,
      output: a1.text,
      failedOver: false,
      attempts: [a1.attempt],
      streamed: a1.streamed,
      message: withAuthHints(
        `${first} ${a1.outcome}; role "${req.role}" needs ${roleCfg.needs.join(", ")} and cannot fail over`,
        [a1.attempt],
      ),
    });
  }

  const second = otherAgent(first);
  if (cooling(second)) {
    return record({
      status: "failed",
      agent: first,
      output: a1.text,
      failedOver: false,
      attempts: [a1.attempt],
      streamed: a1.streamed,
      message: withAuthHints(
        `${first} ${a1.outcome}; ${second} unavailable (${describeCooldowns()})`,
        [a1.attempt],
      ),
    });
  }

  // A resumed session cannot answer once the agent is rate-limited or logged out,
  // so only ask for a summary after a plain failure.
  const summary = a1.outcome === "failed" ? await requestSummary(deps, first, req) : undefined;
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
    output: a2.text,
    failedOver: true,
    attempts: [a1.attempt, a2.attempt],
    usage: a2.attempt.usage,
    streamed: a2.streamed,
    message:
      a2.outcome === "ok"
        ? undefined
        : withAuthHints(
            `${first} ${a1.outcome}, then ${second} ${a2.outcome}: ${a2.detail.trim().slice(0, 300)}`,
            [a1.attempt, a2.attempt],
          ),
  });
}
