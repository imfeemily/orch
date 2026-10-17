import type { TaskResult } from "./types.js";

/** The plan of a dry run: one line per role with the agent and any skip reason. */
export function formatPlan(result: TaskResult): string {
  const steps = result.plan ?? [];
  const width = Math.max(0, ...steps.map((s) => s.role.length));
  const lines = steps.map((s) => {
    const mates = s.group === undefined ? [] : steps.filter((o) => o.group === s.group && o !== s).map((o) => o.role);
    const parallel = mates.length > 0 ? `  (parallel with ${mates.join(", ")})` : "";
    return `  ${s.role.padEnd(width)}  ${s.agent ?? "-"}${s.skipReason ? `  skip: ${s.skipReason}` : ""}${parallel}`;
  });
  return [`plan: ${result.message ?? ""}`.trimEnd(), ...lines].join("\n");
}

/** Per-role outcomes of a team run, for stderr. */
export function formatRoles(result: TaskResult): string {
  const roles = result.roles ?? [];
  if (roles.length === 0) return "";
  const lines = roles.map((r) => `  ${r.role} ${r.status}${r.reason ? `: ${r.reason}` : ""}`);
  return ["roles:", ...lines].join("\n");
}

/** What automatic selection chose, with the reasons. */
export function formatSelection(sel: { roles: string[]; reasons: string[]; dropped: string[] }): string {
  const head = sel.roles.length > 0 ? `auto: roles ${sel.roles.join(", ")}` : "auto: no roles";
  return [head, ...sel.reasons.map((r) => `  ${r}`)].join("\n");
}

/** Image and diagram files that roles left in their assets directories. */
export function formatAssets(result: TaskResult): string {
  const lines: string[] = [];
  for (const r of result.roles ?? []) {
    if (r.assets === undefined) continue;
    lines.push(`  ${r.role}: ${r.assets.length > 0 ? r.assets.join(", ") : "no files"}`);
  }
  if (result.assets && result.assets.length > 0) lines.push(`  ${result.assets.join(", ")}`);
  return lines.length > 0 ? ["assets:", ...lines].join("\n") : "";
}
