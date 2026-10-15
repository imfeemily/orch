import type { Outcome, RunResult } from "./types.js";

export function classify(result: RunResult, patterns: string[]): Outcome {
  if (result.exitCode === 0) return "ok";
  const text = `${result.stderr}\n${result.stdout}`;
  for (const p of patterns) {
    if (new RegExp(p, "i").test(text)) return "limited";
  }
  return "failed";
}
