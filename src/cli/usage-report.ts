import type { UsageRow } from "../core/usage.js";

const n = (v: number) => v.toLocaleString("en-US");

export function formatUsage(rows: UsageRow[], since: string): string {
  if (rows.length === 0) return `no usage recorded in the last ${since}`;
  const width = Math.max(...rows.map((r) => r.key.length));
  const lines = rows.map((r) => {
    const cost = r.costUsd > 0 ? `  $${r.costUsd.toFixed(4)}` : "";
    return `${r.key.padEnd(width)}  ${n(r.tasks)} tasks  ${n(r.billableTokens)} tokens  (in ${n(r.inputTokens)}, cache read ${n(r.cacheReadTokens)}, out ${n(r.outputTokens)})${cost}`;
  });
  return [`usage in the last ${since}`, ...lines].join("\n");
}
