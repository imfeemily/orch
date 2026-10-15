import type { AgentName, Config } from "./types.js";

export function otherAgent(a: AgentName): AgentName {
  return a === "claude" ? "codex" : "claude";
}

function preferredAgent(config: Config, prompt: string): AgentName {
  for (const rule of config.rules) {
    if (new RegExp(rule.match, "i").test(prompt)) return rule.agent;
  }
  return config.defaultAgent;
}

export function pickAgent(
  config: Config,
  prompt: string,
  isCooling: (a: AgentName) => boolean,
): AgentName | null {
  const preferred = preferredAgent(config, prompt);
  if (!isCooling(preferred)) return preferred;
  const alt = otherAgent(preferred);
  return isCooling(alt) ? null : alt;
}
