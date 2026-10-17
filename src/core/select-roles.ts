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

const QUESTION_START =
  /^\s*(explain|what|where|why|how does|how do|how is|how are|how can|describe|summari[sz]e|list|show me|tell me|is|are|can|could|does|do|should|who|which|when)\b/i;
const CHANGE_VERB = /\b(add|fix|implement|create|write|change|update|remove|refactor|migrate|build|make)\b/i;
const POLITE_REQUEST = /^\s*(please\b|(can|could|would|will) you\b)/i;
const THAI_QUESTION = ["อธิบาย", "อะไร", "ทำไม", "อย่างไร", "ยังไง", "ไหม", "หรือไม่"];
const THAI_CHANGE = ["เพิ่ม", "แก้", "สร้าง", "เขียน", "ลบ", "เปลี่ยน", "ปรับ", "ทำให้", "อัปเดต", "รีแฟกเตอร์"];

/** A prompt that asks for information, not for an edit. A polite request to change something is not a question. */
function isQuestion(prompt: string): boolean {
  const p = prompt.trim();
  if (POLITE_REQUEST.test(p) && CHANGE_VERB.test(p)) return false;
  if (/[?？]\s*$/.test(p)) return true;
  if (QUESTION_START.test(p) && !CHANGE_VERB.test(p)) return true;
  return THAI_QUESTION.some((w) => p.includes(w)) && !THAI_CHANGE.some((w) => p.includes(w));
}
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

/** Whole-word match that also accepts common endings: tests, fixing, migrated, boundaries. */
function hasWord(text: string, word: string): boolean {
  const parts = word.trim().split(/\s+/).map(escape);
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1);
  const forms = [`${last}(?:s|es|ed|d|ing)?`];
  if (/e$/i.test(word)) forms.push(`${last.slice(0, -1)}ing`);
  if (/y$/i.test(word)) forms.push(`${last.slice(0, -1)}ies`);
  const pattern = [...head, `(?:${forms.join("|")})`].join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/** Picks roles from the prompt with plain keyword rules; never calls a model. */
export function selectRoles(config: Config, prompt: string): Selection {
  if (isQuestion(prompt)) {
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

  // Roles the user added (or developer) can carry their own words under auto.keywords.
  for (const [role, words] of Object.entries(config.auto.keywords ?? {})) {
    if (role === "developer" || Object.hasOwn(DEFAULT_KEYWORDS, role) || !exists(role)) continue;
    const hit = words.find((w) => hasWord(prompt, w));
    if (hit) picked.set(role, `${role}: matched "${hit}"`);
  }

  const rank = (list: string[], r: string) => (list.includes(r) ? list.indexOf(r) : list.length);
  const byPriority = [...picked.keys()].sort((a, b) => rank(PRIORITY, a) - rank(PRIORITY, b));
  const kept = byPriority.slice(0, config.auto.maxRoles);
  const dropped = byPriority.slice(config.auto.maxRoles);
  const roles = kept.sort((a, b) => rank(CANONICAL_ORDER, a) - rank(CANONICAL_ORDER, b));

  const reasons = roles.map((r) => picked.get(r) as string);
  if (dropped.length > 0) {
    reasons.push(`not run because of the limit of ${config.auto.maxRoles} roles: ${dropped.join(", ")}`);
  }
  return { roles, reasons, dropped };
}
