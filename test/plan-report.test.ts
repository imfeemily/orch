import { describe, expect, it } from "vitest";
import { formatAssets, formatPlan, formatRoles, formatSelection } from "../src/core/plan-report.js";
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

describe("formatPlan parallel note", () => {
  it("shows which roles run in parallel", () => {
    const out = formatPlan({
      ...base,
      message: "3 model calls planned",
      plan: [
        { role: "developer", agent: "claude" },
        { role: "reviewer", agent: "claude", group: 1 },
        { role: "security", agent: "claude", group: 1 },
      ],
    });
    expect(out).toContain("reviewer");
    expect(out).toMatch(/reviewer .*\(parallel with security\)/);
    expect(out).toMatch(/security .*\(parallel with reviewer\)/);
    expect(out.split("\n").find((l) => l.includes("developer"))).not.toContain("parallel");
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

describe("formatSelection", () => {
  it("lists the roles and the reasons, and the dropped ones", () => {
    const out = formatSelection({
      roles: ["developer", "tester"],
      reasons: ['developer: every change task', 'tester: matched "fix"', "not run because of the limit of 2 roles: reviewer"],
      dropped: ["reviewer"],
    });
    expect(out).toContain("auto: roles developer, tester");
    expect(out).toContain('tester: matched "fix"');
    expect(out).toContain("reviewer");
  });

  it("says no roles for a question", () => {
    const out = formatSelection({ roles: [], reasons: ["question or explanation"], dropped: [] });
    expect(out).toContain("auto: no roles");
    expect(out).toContain("question or explanation");
  });
});

describe("formatAssets", () => {
  it("lists files per role and says when a role left none", () => {
    const out = formatAssets({
      ...base,
      status: "ok",
      roles: [
        { role: "developer", agent: "claude", status: "ok" },
        { role: "designer", agent: "codex", status: "ok", assets: ["/p/.orch/runs/a/assets/mockup.png"] },
        { role: "pic", agent: "codex", status: "ok", assets: [] },
      ],
    });
    expect(out).toContain("designer: /p/.orch/runs/a/assets/mockup.png");
    expect(out).toContain("pic: no files");
    expect(out).not.toContain("developer");
  });

  it("handles a single role result and is empty when there are no assets", () => {
    expect(formatAssets({ ...base, assets: ["/p/a.png"] })).toContain("/p/a.png");
    expect(formatAssets(base)).toBe("");
  });
});
