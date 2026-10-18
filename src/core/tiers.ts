import type { Route } from "./router.js";
import { hasWord } from "./select-roles.js";
import type { AgentName, Config, TierName } from "./types.js";

const LARGE_WORDS = [
  "refactor", "migrate", "migration", "architecture", "redesign", "rewrite", "race condition", "deadlock",
  "concurrency", "performance", "security audit", "investigate", "root cause", "design",
  "รีแฟกเตอร์", "ออกแบบ", "สถาปัตยกรรม", "ย้ายระบบ",
];
const SMALL_WORDS = [
  "typo", "rename", "summarize", "summary", "format", "comment", "docstring", "changelog", "one-liner", "bump",
  "ตัวสะกด", "สรุป", "เปลี่ยนชื่อ",
];
const LONG_PROMPT_CHARS = 2000;

export interface TierGuess {
  tier: TierName;
  reason: string;
}

/** Sorts a prompt into small, medium or large with plain keyword rules; never calls a model. */
export function classifyTier(prompt: string): TierGuess {
  const large = LARGE_WORDS.find((w) => hasWord(prompt, w));
  if (large) return { tier: "large", reason: `matched "${large}"` };
  if (prompt.length > LONG_PROMPT_CHARS) return { tier: "large", reason: "very long prompt" };
  const small = SMALL_WORDS.find((w) => hasWord(prompt, w));
  if (small) return { tier: "small", reason: `matched "${small}"` };
  return { tier: "medium", reason: "no small or large keyword" };
}

export interface OnlyRoute extends TierGuess {
  route: Route;
}

/**
 * The route for `--only <agent>`: the agent's own settings for the prompt's tier. A rule for the same
 * agent that matches the prompt overrides the tier's fields; a rule for the other agent is ignored.
 */
export function pickOnlyRoute(config: Config, agent: AgentName, prompt: string): OnlyRoute {
  const guess = classifyTier(prompt);
  const route: Route = { agent, ...config.tiers[agent][guess.tier] };
  const rule = config.rules.find((r) => r.agent === agent && new RegExp(r.match, "i").test(prompt));
  if (rule?.model) route.model = rule.model;
  if (rule?.effort) route.effort = rule.effort;
  if (rule?.context) route.context = rule.context;
  if (route.write === undefined) route.write = true;
  return { ...guess, route };
}
