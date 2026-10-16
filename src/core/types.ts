export type AgentName = "claude" | "codex";
export type Outcome = "ok" | "limited" | "auth" | "failed";

export interface AgentConfig {
  command: string;
  /** argv template; every "{prompt}" substring is replaced by the prompt */
  args: string[];
  /** argv template used to ask the agent for a summary (handoff v2); omit to disable */
  summaryArgs?: string[];
  /** argv template inserted when a rule picks a model; every "{model}" is replaced */
  modelArgs?: string[];
  /** argv template inserted when a rule picks an effort level; every "{effort}" is replaced */
  effortArgs?: string[];
  /** case-insensitive regexes matched against stderr+stdout of a non-zero exit */
  limitPatterns: string[];
  /** case-insensitive regexes that mean "not logged in" (checked after limitPatterns) */
  authPatterns: string[];
  defaultCooldownSec: number;
}

export interface RouteRule {
  /** case-insensitive regex tested against the prompt */
  match: string;
  agent: AgentName;
  /** model for this agent when the rule matches (needs the agent's modelArgs) */
  model?: string;
  /** effort level for this agent when the rule matches (needs the agent's effortArgs) */
  effort?: string;
}

export interface Config {
  defaultAgent: AgentName;
  agents: Record<AgentName, AgentConfig>;
  rules: RouteRule[];
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  depth: number;
  onChunk?: (text: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type RunFn = (
  command: string,
  args: string[],
  prompt: string,
  opts: RunOptions,
) => Promise<RunResult>;

export interface Attempt {
  agent: AgentName;
  outcome: Outcome;
  exitCode: number | null;
  stderr: string;
}

export interface TaskResult {
  status: "ok" | "failed" | "rejected" | "unavailable";
  agent: AgentName | null;
  output: string;
  failedOver: boolean;
  attempts: Attempt[];
  message?: string;
}

export interface JobEntry {
  at: number;
  agent: AgentName | null;
  status: TaskResult["status"];
  failedOver: boolean;
  promptPreview: string;
  model?: string;
}
