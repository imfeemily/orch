import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { AgentName, Config } from "./types.js";

export const AGENT_NAMES: AgentName[] = ["claude", "codex"];

const LIMIT_PATTERNS = [
  "rate.?limit",
  "usage limit",
  "quota",
  "too many requests",
  "limit reached",
  "overloaded",
];

export const DEFAULT_CONFIG: Config = {
  defaultAgent: "claude",
  agents: {
    claude: {
      command: "claude",
      args: ["-p", "--", "{prompt}"],
      summaryArgs: ["-c", "-p", "--", "{prompt}"],
      limitPatterns: LIMIT_PATTERNS,
      defaultCooldownSec: 3600,
    },
    codex: {
      command: "codex",
      args: ["exec", "--", "{prompt}"],
      summaryArgs: ["exec", "resume", "--last", "--", "{prompt}"],
      limitPatterns: LIMIT_PATTERNS,
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

export function loadConfig(path?: string): Config {
  const file = path ?? process.env.ORCH_CONFIG ?? join(orchHome(), "config.yaml");
  if (!existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  const raw = parse(readFileSync(file, "utf8")) ?? {};
  const cfg: Config = {
    defaultAgent: raw.defaultAgent ?? DEFAULT_CONFIG.defaultAgent,
    agents: {
      claude: { ...DEFAULT_CONFIG.agents.claude, ...(raw.agents?.claude ?? {}) },
      codex: { ...DEFAULT_CONFIG.agents.codex, ...(raw.agents?.codex ?? {}) },
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
  }
  for (const name of AGENT_NAMES) {
    cfg.agents[name].limitPatterns.forEach(assertRegex);
  }
}

/** Writes the default config to `path` unless a file already exists there. */
export function initConfig(path: string = join(orchHome(), "config.yaml")): "created" | "exists" {
  if (existsSync(path)) return "exists";
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, stringify(DEFAULT_CONFIG));
  return "created";
}
