export type AgentName = "claude" | "codex";
export type Outcome = "ok" | "limited" | "auth" | "failed";

/** How to read an agent's stdout: one JSON object, JSON Lines, or plain text. */
export type OutputKind = "claude-json" | "codex-jsonl" | "text";

/** Token usage of one agent run. `inputTokens` excludes cache reads. */
export interface Usage {
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export interface AgentOutput {
  /** the agent's final answer */
  text: string;
  /** the error message when the agent reported a failure in its output */
  errorText?: string;
  usage?: Usage;
}

export interface AgentConfig {
  command: string;
  /** argv template; every "{prompt}" substring is replaced by the prompt */
  args: string[];
  /** argv template used to ask the agent for a summary (handoff v2); omit to disable */
  summaryArgs?: string[];
  /** how to read this agent's stdout (answer, error text, token usage) */
  output: OutputKind;
  /** argv template inserted when a rule picks a model; every "{model}" is replaced */
  modelArgs?: string[];
  /** argv template inserted when a rule picks an effort level; every "{effort}" is replaced */
  effortArgs?: string[];
  /** flags that let the agent edit files; added when a tier says `write: true` (--only mode) */
  writeArgs?: string[];
  /** case-insensitive regexes matched against stderr+stdout of a non-zero exit */
  limitPatterns: string[];
  /** case-insensitive regexes that mean "not logged in" (checked after limitPatterns) */
  authPatterns: string[];
  defaultCooldownSec: number;
  /** stop an agent run that takes longer than this many seconds; none by default */
  timeoutSec?: number;
}

export type TierName = "small" | "medium" | "large";

/** What an agent runs with for one tier of work (all optional; needs the agent's modelArgs/effortArgs). */
export interface TierChoice {
  model?: string;
  effort?: string;
  context?: string;
  /** let the agent edit files in this tier (default true); needs the agent's writeArgs */
  write?: boolean;
}

export type Tiers = Record<AgentName, Record<TierName, TierChoice>>;

export interface RouteRule {
  /** case-insensitive regex tested against the prompt */
  match: string;
  agent: AgentName;
  /** model for this agent when the rule matches (needs the agent's modelArgs) */
  model?: string;
  /** effort level for this agent when the rule matches (needs the agent's effortArgs) */
  effort?: string;
  /** name of a `contexts` preset to apply (works for whichever agent runs) */
  context?: string;
}

/** Named sets of extra CLI flags per agent, used to shrink the fixed context of each call. */
export type ContextPresets = Record<string, Partial<Record<AgentName, string[]>>>;

/** What a role needs from the agent that runs it. */
export type Capability = "image";

export interface RoleConfig {
  /** the instructions that define the role */
  prompt: string;
  /** pin the role to an agent; otherwise normal routing applies */
  agent?: AgentName;
  model?: string;
  effort?: string;
  /** name of a `contexts` preset */
  context?: string;
  needs: Capability[];
  /** may the role change project files */
  writes: boolean;
  /** extra argv per agent, for example permission flags for roles that write */
  agentArgs?: Partial<Record<AgentName, string[]>>;
}

/** Automatic role selection (no model call; keyword rules). */
export interface AutoConfig {
  enabled: boolean;
  maxRoles: number;
  /** extra words per role, added to the built-in lists */
  keywords?: Record<string, string[]>;
}

export interface Config {
  defaultAgent: AgentName;
  agents: Record<AgentName, AgentConfig>;
  rules: RouteRule[];
  tiers: Tiers;
  contexts: ContextPresets;
  roles: Record<string, RoleConfig>;
  /** team name to role names */
  teams: Record<string, string[]>;
  pipeline: { handoffChars: number; parallel: boolean; maxParallel: number };
  auto: AutoConfig;
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
  usage?: Usage;
  model?: string;
}

export interface TaskResult {
  status: "ok" | "failed" | "rejected" | "unavailable" | "planned";
  agent: AgentName | null;
  output: string;
  failedOver: boolean;
  attempts: Attempt[];
  /** what automatic selection chose and why */
  selection?: { roles: string[]; reasons: string[]; dropped: string[] };
  /** files a single image role left in its assets directory */
  assets?: string[];
  /** per-role outcomes of a team run */
  roles?: RoleResult[];
  /** the plan of a dry run */
  plan?: PlanStep[];
  /** true when the final answer was already forwarded through onChunk */
  streamed?: boolean;
  /** token usage of all attempts of the task (a failover adds the second), when agents reported it */
  usage?: Usage;
  message?: string;
}

export interface JobEntry {
  at: number;
  agent: AgentName | null;
  status: TaskResult["status"];
  failedOver: boolean;
  promptPreview: string;
  model?: string;
  context?: string;
  role?: string;
}

export interface RoleResult {
  role: string;
  agent: AgentName | null;
  status: "ok" | "failed" | "skipped" | "not-run";
  reason?: string;
  artifact?: string;
  /** files an image role left in its assets directory (listed from disk, not from model text) */
  assets?: string[];
  usage?: Usage;
}

export interface PlanStep {
  role: string;
  agent: AgentName | null;
  skipReason?: string;
  /** steps that share a number run at the same time */
  group?: number;
}
