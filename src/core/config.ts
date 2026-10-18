import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { AgentConfig, AgentName, Capability, Config, ContextPresets, OutputKind, RoleConfig, TierName, Tiers } from "./types.js";

export const AGENT_NAMES: AgentName[] = ["claude", "codex"];
const CAPABILITIES: Capability[] = ["image"];
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
      writeArgs: ["--permission-mode", "acceptEdits"],
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
      writeArgs: ["-s", "workspace-write"],
      limitPatterns: LIMIT_PATTERNS,
      authPatterns: AUTH_PATTERNS,
      defaultCooldownSec: 3600,
    },
  },
  tiers: {
    claude: {
      small: { model: "haiku", effort: "low", context: "lean", write: true },
      medium: { model: "sonnet", effort: "medium", write: true },
      large: { model: "opus", effort: "high", write: true },
    },
    codex: {
      small: { effort: "low", context: "lean", write: true },
      medium: { effort: "medium", write: true },
      large: { effort: "high", write: true },
    },
  },
  contexts: {
    lean: {
      claude: ["--setting-sources", "project", "--disable-slash-commands"],
      codex: ["--disable", "hooks", "--disable", "plugins", "--disable", "apps"],
    },
    minimal: {
      claude: ["--safe-mode"],
      codex: [
        "--disable", "hooks", "--disable", "plugins", "--disable", "apps",
        "--disable", "multi_agent", "--disable", "goals", "--disable", "image_generation",
      ],
    },
  },
  roles: {
    developer: {
      prompt:
        "You are the developer. Implement the task below with the smallest change that satisfies it. Edit the project files directly, follow the project's existing conventions, and do not add unrelated changes.",
      needs: [],
      writes: true,
      agentArgs: { claude: ["--permission-mode", "acceptEdits"], codex: ["-s", "workspace-write"] },
    },
    tester: {
      prompt:
        "You are the tester. Add or update automated tests for the task below and for the changes already made in the working tree. Change test files only, never application code. Run the tests only if the project already has them set up.",
      needs: [],
      writes: true,
      agentArgs: { claude: ["--permission-mode", "acceptEdits"], codex: ["-s", "workspace-write"] },
    },
    architecture: {
      prompt:
        "You are the software architect. Analyse the task below and the repository. Describe the design, the module boundaries it touches and the main risks. When a picture helps, include a Mermaid diagram in a fenced code block. Do not modify any files.",
      context: "lean",
      needs: [],
      writes: false,
    },
    designer: {
      prompt:
        "You are a UX/UI designer. Create mockup or diagram images for the task below. Save image files only into the assets directory named at the end of this prompt, and do not change any project files. Reply with the file paths and a short description of each image.",
      agent: "codex",
      needs: ["image"],
      writes: false,
      agentArgs: { codex: ["-s", "workspace-write"] },
    },
    security: {
      prompt:
        "You are a security reviewer. Review the working-tree changes (use git status and git diff) against the task below for security problems such as injection, broken authorization, exposed secrets, unsafe dependencies and data exposure. Report the most serious first, with file and line. Do not modify any files.",
      context: "lean",
      needs: [],
      writes: false,
    },
    reviewer: {
      prompt:
        "You are a code reviewer. Review the working-tree changes (use git status and git diff) against the task below. Report bugs, risky behavior and missing tests, most serious first, with file and line. Do not modify any files.",
      context: "lean",
      needs: [],
      writes: false,
    },
  },
  teams: {
    quick: ["developer"],
    standard: ["developer", "tester", "reviewer"],
    full: ["architecture", "designer", "developer", "tester", "reviewer", "security"],
  },
  pipeline: { handoffChars: 4000, parallel: true, maxParallel: 2 },
  auto: { enabled: false, maxRoles: 3 },
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

/** User presets add to or override the built-in ones, per preset name and per agent. */
const TIER_NAMES = ["small", "medium", "large"];

/** User tiers add to the built-in ones per agent, tier and key. */
function mergeTiers(user: unknown): Tiers {
  const merged: Tiers = structuredClone(DEFAULT_CONFIG.tiers);
  if (user === undefined || user === null) return merged;
  if (!plainObject(user)) throw new Error("tiers must be a mapping of agent names to tier settings");
  for (const [agent, tiers] of Object.entries(user)) {
    if (!AGENT_NAMES.includes(agent as AgentName)) throw new Error(`tiers.${agent} is not an agent (use ${AGENT_NAMES.join(", ")})`);
    if (!plainObject(tiers)) throw new Error(`tiers.${agent} must be a mapping of small, medium, large`);
    for (const [tier, choice] of Object.entries(tiers)) {
      if (!TIER_NAMES.includes(tier)) throw new Error(`tiers.${agent}.${tier} is not a tier (use ${TIER_NAMES.join(", ")})`);
      if (!plainObject(choice)) throw new Error(`tiers.${agent}.${tier} must be a mapping of model, effort, context`);
      const slot = merged[agent as AgentName];
      slot[tier as TierName] = { ...slot[tier as TierName], ...choice };
    }
  }
  return merged;
}

function mergeContexts(user: unknown): ContextPresets {
  const merged: ContextPresets = structuredClone(DEFAULT_CONFIG.contexts);
  if (user && typeof user === "object") {
    for (const [name, preset] of Object.entries(user as Record<string, unknown>)) {
      merged[name] = preset && typeof preset === "object" ? { ...merged[name], ...(preset as object) } : (preset as never);
    }
  }
  return merged;
}

/** User roles add to or override the built-in ones, per role name and per key. */
function mergeRoles(user: unknown): Record<string, RoleConfig> {
  const merged: Record<string, RoleConfig> = structuredClone(DEFAULT_CONFIG.roles);
  if (user && typeof user === "object") {
    for (const [name, role] of Object.entries(user as Record<string, Record<string, unknown>>)) {
      if (role !== null && role !== undefined && (typeof role !== "object" || Array.isArray(role))) {
        throw new Error(`roles.${name} must be a mapping of role settings`);
      }
      const base = merged[name] ?? { needs: [], writes: true };
      const next = { ...base, ...(role ?? {}) } as RoleConfig;
      if (role?.agentArgs && base.agentArgs) next.agentArgs = { ...base.agentArgs, ...(role.agentArgs as object) };
      merged[name] = next;
    }
  }
  return merged;
}

function plainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeKnown<T extends object>(name: string, defaults: T, user: unknown, known: string[]): T {
  if (user === undefined || user === null) return structuredClone(defaults);
  if (!plainObject(user)) throw new Error(`${name} must be a mapping (${known.join(", ")})`);
  for (const key of Object.keys(user)) {
    if (!known.includes(key)) throw new Error(`${name}.${key} is not a known setting (use ${known.join(", ")})`);
  }
  if (name === "auto" && user.keywords !== undefined && !plainObject(user.keywords)) {
    throw new Error("auto.keywords must map role names to word lists");
  }
  return { ...structuredClone(defaults), ...user } as T;
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
    tiers: mergeTiers(raw.tiers),
    contexts: mergeContexts(raw.contexts),
    roles: mergeRoles(raw.roles),
    teams: { ...structuredClone(DEFAULT_CONFIG.teams), ...(raw.teams ?? {}) },
    pipeline: mergeKnown("pipeline", DEFAULT_CONFIG.pipeline, raw.pipeline, ["handoffChars", "parallel", "maxParallel"]),
    auto: mergeKnown("auto", DEFAULT_CONFIG.auto, raw.auto, ["enabled", "maxRoles", "keywords"]),
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
  for (const [name, preset] of Object.entries(cfg.contexts)) {
    if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
      throw new Error(`contexts.${name} must map agent names to argument lists`);
    }
    for (const [agent, args] of Object.entries(preset)) {
      if (!AGENT_NAMES.includes(agent as AgentName)) throw new Error(`contexts.${name}: unknown agent "${agent}"`);
      if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
        throw new Error(`contexts.${name}.${agent} must be a list of strings`);
      }
    }
  }
  for (const [name, role] of Object.entries(cfg.roles)) {
    if (!/^[a-z0-9_-]+$/i.test(name)) {
      throw new Error(`role name "${name}" may only contain letters, digits, "-" and "_"`);
    }
    const at = `roles.${name}`;
    if (!role || typeof role !== "object" || typeof role.prompt !== "string" || !role.prompt.trim()) {
      throw new Error(`${at}.prompt is required`);
    }
    if (role.agent !== undefined && !AGENT_NAMES.includes(role.agent)) {
      throw new Error(`${at}.agent must be one of ${AGENT_NAMES.join(", ")}`);
    }
    if (role.context !== undefined && !Object.hasOwn(cfg.contexts, role.context)) {
      throw new Error(`${at}.context "${role.context}" is not a defined context`);
    }
    if (!Array.isArray(role.needs) || !role.needs.every((n) => CAPABILITIES.includes(n))) {
      throw new Error(`${at}.needs must list capabilities from: ${CAPABILITIES.join(", ")}`);
    }
    if (role.needs.includes("image") && role.agent !== undefined && role.agent !== "codex") {
      throw new Error(`${at}: a role that needs image must use agent codex`);
    }
    if (typeof role.writes !== "boolean") throw new Error(`${at}.writes must be true or false`);
    for (const [agent, args] of Object.entries(role.agentArgs ?? {})) {
      if (!AGENT_NAMES.includes(agent as AgentName) || !Array.isArray(args) || !args.every((a) => typeof a === "string")) {
        throw new Error(`${at}.agentArgs.${agent} must be a list of strings for claude or codex`);
      }
    }
  }
  for (const [team, names] of Object.entries(cfg.teams)) {
    if (!Array.isArray(names)) throw new Error(`teams.${team} must be a list of role names`);
    if (names.length === 0) throw new Error(`teams.${team} must name at least one role`);
    for (const r of names) {
      if (!Object.hasOwn(cfg.roles, r)) throw new Error(`teams.${team} names unknown role "${r}"`);
    }
  }
  const auto = cfg.auto;
  if (typeof auto.enabled !== "boolean") throw new Error("auto.enabled must be true or false");
  if (!Number.isInteger(auto.maxRoles) || auto.maxRoles <= 0) throw new Error("auto.maxRoles must be a positive integer");
  for (const [role, words] of Object.entries(auto.keywords ?? {})) {
    if (!Object.hasOwn(cfg.roles, role)) throw new Error(`auto.keywords names unknown role "${role}"`);
    if (!Array.isArray(words) || !words.every((w) => typeof w === "string")) {
      throw new Error(`auto.keywords.${role} must be a list of strings`);
    }
  }
  if (!Number.isInteger(cfg.pipeline.handoffChars) || cfg.pipeline.handoffChars <= 0) {
    throw new Error("pipeline.handoffChars must be a positive integer");
  }
  if (typeof cfg.pipeline.parallel !== "boolean") throw new Error("pipeline.parallel must be true or false");
  if (!Number.isInteger(cfg.pipeline.maxParallel) || cfg.pipeline.maxParallel < 1) {
    throw new Error("pipeline.maxParallel must be an integer of at least 1");
  }
  for (const rule of cfg.rules) {
    if (rule.context !== undefined && !Object.hasOwn(cfg.contexts, rule.context)) {
      throw new Error(`rule "${rule.match}" uses unknown context "${rule.context}"`);
    }
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
  for (const agentName of AGENT_NAMES) {
    for (const tier of TIER_NAMES as TierName[]) {
      const c = cfg.tiers[agentName][tier];
      const at = `tiers.${agentName}.${tier}`;
      if (c.write !== undefined && typeof c.write !== "boolean") throw new Error(`${at}.write must be true or false`);
      if (c.write && !cfg.agents[agentName].writeArgs?.length) throw new Error(`${at} sets write but ${agentName} has no writeArgs`);
      if (c.context !== undefined && !Object.hasOwn(cfg.contexts, c.context)) throw new Error(`${at} uses unknown context "${c.context}"`);
      if (c.model && !cfg.agents[agentName].modelArgs?.length) throw new Error(`${at} sets a model but ${agentName} has no modelArgs`);
      if (c.effort && !cfg.agents[agentName].effortArgs?.length) throw new Error(`${at} sets an effort but ${agentName} has no effortArgs`);
    }
  }
  for (const name of AGENT_NAMES) {
    if (!OUTPUT_KINDS.includes(cfg.agents[name].output)) {
      throw new Error(`agents.${name}.output must be one of ${OUTPUT_KINDS.join(", ")}`);
    }
    const wa = cfg.agents[name].writeArgs;
    if (wa !== undefined && !(Array.isArray(wa) && wa.every((a) => typeof a === "string"))) {
      throw new Error(`agents.${name}.writeArgs must be a list of strings`);
    }
    const t = cfg.agents[name].timeoutSec;
    if (t !== undefined && !(typeof t === "number" && t > 0 && t * 1000 <= 2_147_483_647)) {
      throw new Error(`agents.${name}.timeoutSec must be a positive number of seconds (at most 2147483)`);
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
