import type { Outcome, RunResult } from "./types.js";

const TAIL_LINES = 20;

/**
 * The part of a failed run worth pattern-matching: all of stderr plus only the
 * tail of stdout. Earlier stdout lines are the agent's work text and may
 * legitimately mention "rate limit" (e.g. a task about rate limiting).
 */
export function relevantText(result: RunResult): string {
  const tail = result.stdout.split("\n").slice(-TAIL_LINES).join("\n");
  return `${result.stderr}\n${tail}`;
}

function matchesAny(patterns: string[], text: string): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(text));
}

export function classify(
  result: RunResult,
  limitPatterns: string[],
  authPatterns: string[] = [],
): Outcome {
  if (result.exitCode === 0) return "ok";
  const text = relevantText(result);
  if (matchesAny(limitPatterns, text)) return "limited";
  if (matchesAny(authPatterns, text)) return "auth";
  return "failed";
}
