import type { AgentConfig } from "./types.js";

export interface ModelChoice {
  model?: string;
  effort?: string;
  /** extra flags from a context preset for this agent */
  contextArgs?: string[];
}

/**
 * The agent's args with model/effort flags inserted right before the `--`
 * that guards the prompt (or before the prompt placeholder, or at the end).
 * A model or effort without a matching template on the agent is ignored.
 */
export function buildAgentArgs(cfg: AgentConfig, choice: ModelChoice): string[] {
  const extra: string[] = [];
  if (choice.model && cfg.modelArgs) {
    extra.push(...cfg.modelArgs.map((a) => a.split("{model}").join(choice.model!)));
  }
  if (choice.effort && cfg.effortArgs) {
    extra.push(...cfg.effortArgs.map((a) => a.split("{effort}").join(choice.effort!)));
  }
  if (choice.contextArgs?.length) extra.push(...choice.contextArgs);
  if (extra.length === 0) return cfg.args;

  let at = cfg.args.indexOf("--");
  if (at < 0) at = cfg.args.findIndex((a) => a.includes("{prompt}"));
  if (at < 0) at = cfg.args.length;
  return [...cfg.args.slice(0, at), ...extra, ...cfg.args.slice(at)];
}
