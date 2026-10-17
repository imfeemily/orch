import { describe, expect, it } from "vitest";
import { formatPlan, formatRoles } from "../src/cli/plan-report.js";
import type { TaskResult } from "../src/core/types.js";

const base: TaskResult = { status: "planned", agent: null, output: "", failedOver: false, attempts: [] };

describe("formatPlan", () => {
  it("lists each role with its agent, the skip reason, and the call count", () => {
    const out = formatPlan({
      ...base,
      message: "2 model calls planned, 1 skipped",
      plan: [
        { role: "developer", agent: "claude" },
        { role: "pic", agent: "codex", skipReason: "not logged in: run `codex login`" },
        { role: "reviewer", agent: "claude" },
      ],
    });
    expect(out).toContain("developer");
    expect(out).toContain("claude");
    expect(out).toContain("skip: not logged in");
    expect(out).toContain("2 model calls");
  });
});

describe("formatRoles", () => {
  it("shows every role's outcome with its reason", () => {
    const out = formatRoles({
      ...base,
      status: "failed",
      roles: [
        { role: "developer", agent: "claude", status: "ok" },
        { role: "pic", agent: "codex", status: "skipped", reason: "codex not ready" },
        { role: "tester", agent: "claude", status: "failed", reason: "boom" },
        { role: "reviewer", agent: null, status: "not-run", reason: "an earlier role failed" },
      ],
    });
    for (const s of ["developer ok", "pic skipped: codex not ready", "tester failed: boom", "reviewer not-run: an earlier role failed"]) {
      expect(out).toContain(s);
    }
  });

  it("is empty when there are no roles", () => {
    expect(formatRoles(base)).toBe("");
  });
});
