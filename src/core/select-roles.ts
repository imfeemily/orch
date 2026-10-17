import { CANONICAL_ORDER } from "./roles.js";
import type { Config } from "./types.js";

export interface Selection {
  /** roles to run, in canonical order */
  roles: string[];
  /** why each role was chosen (and what was cut) */
  reasons: string[];
  /** roles that matched but did not fit within auto.maxRoles */
  dropped: string[];
}

const QUESTION_START = /^\s*(explain|what|where|why|how does|how do|describe|summari[sz]e|list|show me)\b/i;
const CHANGE_VERB = /\b(add|fix|implement|create|write|change|update|remove|refactor|migrate|build|make)\b/i;
const LONG_PROMPT_CHARS = 400;

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  tester: ["test", "bug", "fix", "regression", "feature", "implement"],
  reviewer: ["refactor", "migrate", "implement", "feature"],
  security: ["auth", "login", "token", "password", "secret", "crypto", "sql", "upload", "permission", "payment"],
  architecture: ["architecture", "design the", "module", "boundary", "api design", "migrate"],
  designer: ["ui", "ux", "screen", "layout", "mockup", "wireframe", "diagram", "image", "logo"],
};

/** When the cap cuts roles, keep these first. */
const PRIORITY = ["developer", "security", "tester", "reviewer", "architecture", "designer"];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string) => new RegExp(`\\b${escape(word)}\\b`, "i").test(text);

/** Picks roles from the prompt with plain keyword rules; never calls a model. */
export function selectRoles(config: Config, prompt: string): Selection {
  if (QUESTION_START.test(prompt) && !CHANGE_VERB.test(prompt)) {
    return { roles: [], reasons: ["question or explanation with no change intent: no roles, run as a plain call"], dropped: [] };
  }

  const exists = (role: string) => Object.hasOwn(config.roles, role);
  const picked = new Map<string, string>();
  if (exists("developer")) picked.set("developer", "developer: every change task");

  for (const [role, defaults] of Object.entries(DEFAULT_KEYWORDS)) {
    if (!exists(role)) continue;
    const words = [...defaults, ...(config.auto.keywords?.[role] ?? [])];
    const hit = words.find((w) => hasWord(prompt, w));
    if (hit) picked.set(role, `${role}: matched "${hit}"`);
    else if (role === "reviewer" && prompt.length > LONG_PROMPT_CHARS) picked.set(role, "reviewer: long prompt");
  }

  const byPriority = [...picked.keys()].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
  const kept = byPriority.slice(0, config.auto.maxRoles);
  const dropped = byPriority.slice(config.auto.maxRoles);
  const roles = kept.sort((a, b) => CANONICAL_ORDER.indexOf(a) - CANONICAL_ORDER.indexOf(b));

  const reasons = roles.map((r) => picked.get(r) as string);
  if (dropped.length > 0) {
    reasons.push(`not run because of the limit of ${config.auto.maxRoles} roles: ${dropped.join(", ")}`);
  }
  return { roles, reasons, dropped };
}
