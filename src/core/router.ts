import type { AgentName, Config, RoleConfig, RouteRule } from "./types.js";

export function otherAgent(a: AgentName): AgentName {
  return a === "claude" ? "codex" : "claude";
}

export interface Route {
  agent: AgentName;
  model?: string;
  effort?: string;
  context?: string;
  /** --only mode: add the agent's writeArgs so it can edit files */
  write?: boolean;
}

function matchRule(config: Config, prompt: string): RouteRule | undefined {
  return config.rules.find((rule) => new RegExp(rule.match, "i").test(prompt));
}

/**
 * Chooses the agent and, when a rule matched, its model/effort/context. If the
 * rule's agent is cooling, the other agent is used with its own defaults: model
 * names are not portable between Claude and Codex, but a context name is.
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
    if (rule?.context) route.context = rule.context;
    return route;
  }
  const alt = otherAgent(preferred);
  if (isCooling(alt)) return null;
  // A context preset maps to each agent's own flags, so its name survives the switch.
  return rule?.context ? { agent: alt, context: rule.context } : { agent: alt };
}

export function pickAgent(
  config: Config,
  prompt: string,
  isCooling: (a: AgentName) => boolean,
): AgentName | null {
  return pickRoute(config, prompt, isCooling)?.agent ?? null;
}

/**
 * Route for a role: its pinned agent (or the one normal routing would pick), with the role's own
 * model, effort and context. A role that needs a capability only runs on codex and never moves.
 */
export function pickRoleRoute(
  config: Config,
  role: RoleConfig,
  prompt: string,
  isCooling: (a: AgentName) => boolean,
): Route | null {
  const pinned = role.needs.length > 0;
  const preferred: AgentName = role.agent ?? (pinned ? "codex" : (matchRule(config, prompt)?.agent ?? config.defaultAgent));
  if (!isCooling(preferred)) {
    const route: Route = { agent: preferred };
    if (role.model) route.model = role.model;
    if (role.effort) route.effort = role.effort;
    if (role.context) route.context = role.context;
    return route;
  }
  if (pinned) return null;
  const alt = otherAgent(preferred);
  if (isCooling(alt)) return null;
  return role.context ? { agent: alt, context: role.context } : { agent: alt };
}
