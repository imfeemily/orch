import type { Outcome, RunResult } from "./types.js";

const TAIL_LINES = 20;

export function classify(result: RunResult, patterns: string[]): Outcome {
  if (result.exitCode === 0) return "ok";
  // Only the tail of stdout: earlier lines are the agent's work text and may
  // legitimately mention "rate limit" (e.g. a task about rate limiting).
  const tail = result.stdout.split("\n").slice(-TAIL_LINES).join("\n");
  const text = `${result.stderr}\n${tail}`;
  for (const p of patterns) {
    if (new RegExp(p, "i").test(text)) return "limited";
  }
  return "failed";
}
