import type { Config, RoleConfig } from "./types.js";

/** Order in which a team's roles run: design before code, review last. */
export const CANONICAL_ORDER = ["architecture", "designer", "developer", "tester", "reviewer", "security"];

export interface RoleSelection {
  role?: string;
  roles?: string[];
  team?: string;
}

export interface Handoff {
  role: string;
  text: string;
}

const list = (names: string[]) => names.join(", ") || "(none)";

/** Turns --role / --roles / --team into the ordered role names to run, or an error. */
export function planRoles(config: Config, sel: RoleSelection): { names: string[] } | { error: string } {
  const used = [
    sel.role !== undefined ? "--role" : "",
    sel.roles !== undefined ? "--roles" : "",
    sel.team !== undefined ? "--team" : "",
  ].filter(Boolean);
  if (used.length === 0) return { error: "choose --role, --roles or --team" };
  if (used.length > 1) return { error: `choose only one of ${used.join(" and ")}` };

  const known = Object.keys(config.roles);
  const unknownRole = (name: string) => `unknown role "${name}"; available: ${list(known)}`;

  if (sel.role !== undefined) {
    return Object.hasOwn(config.roles, sel.role) ? { names: [sel.role] } : { error: unknownRole(sel.role) };
  }
  if (sel.roles !== undefined) {
    const names = [...new Set(sel.roles)];
    if (names.length === 0) return { error: "--roles needs at least one role name" };
    const bad = names.find((n) => !Object.hasOwn(config.roles, n));
    return bad ? { error: unknownRole(bad) } : { names };
  }
  const team = sel.team as string;
  if (!Object.hasOwn(config.teams, team)) {
    return { error: `unknown team "${team}"; available: ${list(Object.keys(config.teams))}` };
  }
  const members = config.teams[team];
  const rank = (n: string) => (CANONICAL_ORDER.includes(n) ? CANONICAL_ORDER.indexOf(n) : CANONICAL_ORDER.length);
  return { names: [...members].sort((a, b) => rank(a) - rank(b)) };
}

export function buildRolePrompt(role: RoleConfig, task: string, handoffs: Handoff[], askHandoff: boolean): string {
  const parts = [role.prompt, `## Task\n${task}`];
  if (handoffs.length > 0) {
    parts.push(`## Earlier roles\n${handoffs.map((h) => `### ${h.role}\n${h.text}`).join("\n\n")}`);
  }
  if (askHandoff) {
    parts.push('Finish your answer with a "## Handoff" section of at most 150 words for the next role.');
  }
  return parts.join("\n\n");
}

const FALLBACK_CHARS = 1500;

/** The text under the last "## Handoff" heading, or the tail of the output when there is none. */
export function extractHandoff(output: string): string {
  const lines = output.split("\n");
  let start = -1;
  lines.forEach((line, i) => {
    if (/^##\s+handoff\s*$/i.test(line)) start = i;
  });
  if (start >= 0) {
    const body: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (/^##\s/.test(line)) break;
      body.push(line);
    }
    const text = body.join("\n").trim();
    if (text) return text;
    return output.slice(0, lines.slice(0, start).join("\n").length).trim().slice(-FALLBACK_CHARS).trim();
  }
  return output.trim().slice(-FALLBACK_CHARS).trim();
}

/** Newest handoffs first within the budget; older ones are cut or dropped. Chronological order is kept. */
export function capHandoffs(handoffs: Handoff[], maxChars: number): Handoff[] {
  const kept: Handoff[] = [];
  let remaining = maxChars;
  for (let i = handoffs.length - 1; i >= 0 && remaining > 0; i--) {
    const text = handoffs[i].text.length <= remaining ? handoffs[i].text : handoffs[i].text.slice(0, remaining);
    kept.unshift({ role: handoffs[i].role, text });
    remaining -= text.length;
  }
  return kept;
}
