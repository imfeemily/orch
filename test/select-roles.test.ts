import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { selectRoles } from "../src/core/select-roles.js";
import type { Config } from "../src/core/types.js";

const cfg = (over: Partial<Config["auto"]> = {}): Config => ({ ...DEFAULT_CONFIG, auto: { ...DEFAULT_CONFIG.auto, ...over } });

describe("selectRoles", () => {
  it("selects no roles for a question or explanation", () => {
    for (const p of ["explain how the router picks an agent", "what does clamp do", "Where is the ledger written?"]) {
      const s = selectRoles(cfg(), p);
      expect(s.roles, p).toEqual([]);
      expect(s.reasons[0]).toContain("question");
    }
  });

  it("treats a question that also asks for a change as a change", () => {
    expect(selectRoles(cfg(), "how do I fix the login bug").roles).toContain("developer");
  });

  it("selects developer and tester for a small fix", () => {
    const s = selectRoles(cfg(), "fix the typo in README");
    expect(s.roles).toEqual(["developer", "tester"]);
    expect(s.reasons.some((r) => r.includes("tester") && r.includes('"fix"'))).toBe(true);
    expect(s.dropped).toEqual([]);
  });

  it("caps the selection by priority and reports what was dropped", () => {
    const s = selectRoles(cfg(), "implement login with a password reset token");
    expect(s.roles).toEqual(["developer", "tester", "security"]); // canonical order of the three kept
    expect(s.dropped).toEqual(["reviewer"]);
    expect(s.reasons.join("\n")).toContain("reviewer");
  });

  it("runs the selected roles in canonical order when the cap allows them all", () => {
    const s = selectRoles(cfg({ maxRoles: 6 }), "design the module boundaries for the payment api and add a login ui screen");
    expect(s.roles).toEqual(["architecture", "designer", "developer", "security"]);
  });

  it("adds a reviewer for a long prompt", () => {
    const s = selectRoles(cfg({ maxRoles: 6 }), `update the report ${"details ".repeat(60)}`);
    expect(s.roles).toContain("reviewer");
  });

  it("matches whole words only, case-insensitively, and phrases as phrases", () => {
    expect(selectRoles(cfg(), "update the contest page").roles).toEqual(["developer"]);
    expect(selectRoles(cfg(), "Add a TEST for the parser").roles).toContain("tester");
    expect(selectRoles(cfg({ maxRoles: 6 }), "design the cache").roles).toContain("architecture");
    expect(selectRoles(cfg({ maxRoles: 6 }), "design a cache").roles).not.toContain("architecture");
  });

  it("extends the default words with the configured keywords", () => {
    const s = selectRoles(cfg({ keywords: { security: ["pii"] } }), "update how we store pii");
    expect(s.roles).toContain("security");
  });

  it("never selects a role that is not in the config", () => {
    const config = cfg();
    const roles = { ...config.roles };
    delete roles.security;
    expect(selectRoles({ ...config, roles }, "update login").roles).not.toContain("security");
  });

  it("names the role and the matched word in every reason", () => {
    const s = selectRoles(cfg(), "fix the login bug");
    for (const role of s.roles.filter((r) => r !== "developer")) {
      expect(s.reasons.some((r) => r.startsWith(role) || r.includes(`${role}:`))).toBe(true);
    }
  });
});
