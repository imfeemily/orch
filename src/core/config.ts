import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { AgentConfig, AgentName, Config, OutputKind } from "./types.js";

export const AGENT_NAMES: AgentName[] = ["claude", "codex"];
const OUTPUT_KINDS: OutputKind[] = ["claude-json", "codex-jsonl", "text"];

const LIMIT_PATTERNS = [
  "rate.?limit",
  "usage limit",
  "quota",
  "too many requests",
  "limit reached",
  "overloaded",
];

const AUTH_PATTERNS = [
  "failed to authenticate",
  "oauth session expired",
  "not logged in",
  "please run /login",
  "invalid api key",
  "could not be refreshed",
  "sign in again",
];

export const DEFAULT_CONFIG: Config = {
  defaultAgent: "claude",
  agents: {
    claude: {
      command: "claude",
      args: ["-p", "--output-format", "json", "--", "{prompt}"],
      output: "claude-json",
      summaryArgs: ["-c", "-p", "--", "{prompt}"],
      modelArgs: ["--model", "{model}"],
      effortArgs: ["--effort", "{effort}"],
      limitPatterns: LIMIT_PATTERNS,
      authPatterns: AUTH_PATTERNS,
      defaultCooldownSec: 3600,
    },
    codex: {
      command: "codex",
      args: ["exec", "--json", "--", "{prompt}"],
      output: "codex-jsonl",
      summaryArgs: ["exec", "resume", "--last", "--", "{prompt}"],
      modelArgs: ["-m", "{model}"],
      effortArgs: ["-c", 'model_reasoning_effort="{effort}"'],
      limitPatterns: LIMIT_PATTERNS,
      authPatterns: AUTH_PATTERNS,
      defaultCooldownSec: 3600,
    },
  },
  rules: [
    { match: "refactor|architecture|migrate|redesign", agent: "claude" },
    { match: "typo|rename|quick|small fix|one-liner", agent: "codex" },
  ],
};

export function orchHome(): string {
  return process.env.ORCH_HOME ?? join(homedir(), ".orch");
}

/** A user who overrides `args` keeps their flags, so read the output kind from them. */
function inferOutput(args: unknown): OutputKind {
  if (!Array.isArray(args)) return "text";
  const i = args.indexOf("--output-format");
  if (i >= 0 && args[i + 1] === "json") return "claude-json";
  if (args.includes("--json")) return "codex-jsonl";
  return "text";
}

function mergeAgent(name: AgentName, user: Record<string, unknown> | undefined): AgentConfig {
  const merged: AgentConfig = { ...DEFAULT_CONFIG.agents[name], ...(user ?? {}) };
  if (user?.args !== undefined && user.output === undefined) merged.output = inferOutput(user.args);
  return merged;
}

export function loadConfig(path?: string): Config {
  const file = path ?? process.env.ORCH_CONFIG ?? join(orchHome(), "config.yaml");
  if (!existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  const raw = parse(readFileSync(file, "utf8")) ?? {};
  const cfg: Config = {
    defaultAgent: raw.defaultAgent ?? DEFAULT_CONFIG.defaultAgent,
    agents: {
      claude: mergeAgent("claude", raw.agents?.claude),
      codex: mergeAgent("codex", raw.agents?.codex),
    },
    rules: raw.rules ?? structuredClone(DEFAULT_CONFIG.rules),
  };
  validate(cfg);
  return cfg;
}

function assertRegex(source: string): void {
  try {
    new RegExp(source, "i");
  } catch {
    throw new Error(`"${source}" is not a valid regex`);
  }
}

function validate(cfg: Config): void {
  if (!AGENT_NAMES.includes(cfg.defaultAgent)) {
    throw new Error(`defaultAgent must be one of ${AGENT_NAMES.join(", ")}`);
  }
  for (const rule of cfg.rules) {
    if (!AGENT_NAMES.includes(rule.agent)) {
      throw new Error(`rule agent "${rule.agent}" must be one of ${AGENT_NAMES.join(", ")}`);
    }
    assertRegex(rule.match);
    const agent = cfg.agents[rule.agent];
    if (rule.model && !agent.modelArgs?.length) {
      throw new Error(`rule "${rule.match}" sets a model but ${rule.agent} has no modelArgs`);
    }
    if (rule.effort && !agent.effortArgs?.length) {
      throw new Error(`rule "${rule.match}" sets an effort but ${rule.agent} has no effortArgs`);
    }
  }
  for (const name of AGENT_NAMES) {
    if (!OUTPUT_KINDS.includes(cfg.agents[name].output)) {
      throw new Error(`agents.${name}.output must be one of ${OUTPUT_KINDS.join(", ")}`);
    }
    cfg.agents[name].limitPatterns.forEach(assertRegex);
    cfg.agents[name].authPatterns.forEach(assertRegex);
  }
}

/** Writes the default config to `path` unless a file already exists there. */
export function initConfig(path: string = join(orchHome(), "config.yaml")): "created" | "exists" {
  if (existsSync(path)) return "exists";
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, stringify(DEFAULT_CONFIG));
  return "created";
}
