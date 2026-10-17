import type { TaskResult } from "../core/types.js";

/** The plan of a dry run: one line per role with the agent and any skip reason. */
export function formatPlan(result: TaskResult): string {
  const steps = result.plan ?? [];
  const width = Math.max(0, ...steps.map((s) => s.role.length));
  const lines = steps.map(
    (s) => `  ${s.role.padEnd(width)}  ${s.agent ?? "-"}${s.skipReason ? `  skip: ${s.skipReason}` : ""}`,
  );
  return [`plan: ${result.message ?? ""}`.trimEnd(), ...lines].join("\n");
}

/** Per-role outcomes of a team run, for stderr. */
export function formatRoles(result: TaskResult): string {
  const roles = result.roles ?? [];
  if (roles.length === 0) return "";
  const lines = roles.map((r) => `  ${r.role} ${r.status}${r.reason ? `: ${r.reason}` : ""}`);
  return ["roles:", ...lines].join("\n");
}
