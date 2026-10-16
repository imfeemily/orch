import type { AgentName, Config, RouteRule } from "./types.js";

export function otherAgent(a: AgentName): AgentName {
  return a === "claude" ? "codex" : "claude";
}

export interface Route {
  agent: AgentName;
  model?: string;
  effort?: string;
}

function matchRule(config: Config, prompt: string): RouteRule | undefined {
  return config.rules.find((rule) => new RegExp(rule.match, "i").test(prompt));
}

/**
 * Chooses the agent and, when a rule matched, its model/effort. If the rule's
 * agent is cooling, the other agent is used with its own defaults: model names
 * are not portable between Claude and Codex.
 */
export function pickRoute(
  config: Config,
  prompt: string,
  isCooling: (a: AgentName) => boolean,
): Route | null {
  const rule = matchRule(config, prompt);
  const preferred = rule?.agent ?? config.defaultAgent;
  if (!isCooling(preferred)) {
    const route: Route = { agent: preferred };
    if (rule?.model) route.model = rule.model;
    if (rule?.effort) route.effort = rule.effort;
    return route;
  }
  const alt = otherAgent(preferred);
  return isCooling(alt) ? null : { agent: alt };
}

export function pickAgent(
  config: Config,
  prompt: string,
  isCooling: (a: AgentName) => boolean,
): AgentName | null {
  return pickRoute(config, prompt, isCooling)?.agent ?? null;
}
