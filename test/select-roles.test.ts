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

  it("recognises questions without a leading question word, with a question mark, and in Thai", () => {
    for (const p of [
      "Is there a bug in auth.ts?",
      "How is the token validated?",
      "Can you tell me how the login token is refreshed?",
      "What should I change in the router?",
      "how do I fix the login bug?",
      "อธิบายว่าโค้ดนี้ทำงานอย่างไร",
      "ทำไม login ถึงช้า",
    ]) {
      expect(selectRoles(cfg(), p).roles, p).toEqual([]);
    }
  });

  it("still treats polite requests and Thai change requests as changes", () => {
    expect(selectRoles(cfg(), "Can you add a login page?").roles).toContain("developer");
    expect(selectRoles(cfg(), "please fix the parser").roles).toContain("developer");
    expect(selectRoles(cfg(), "เพิ่มปุ่ม login ในหน้าแรก").roles).toContain("developer");
  });

  it("matches common word endings (plurals, -ing, -ed, -ies)", () => {
    expect(selectRoles(cfg(), "add unit tests for the parser").roles).toContain("tester");
    const s = selectRoles(cfg({ maxRoles: 6 }), "Implementing new features for payments");
    expect(s.roles).toEqual(expect.arrayContaining(["developer", "tester", "reviewer", "security"]));
    expect(selectRoles(cfg({ maxRoles: 6 }), "migrating the module").roles).toContain("architecture");
    expect(selectRoles(cfg({ maxRoles: 6 }), "clarify the module boundaries").roles).toContain("architecture");
    expect(selectRoles(cfg(), "update the contests page").roles).toEqual(["developer"]);
  });

  it("matches keywords that start or end with a non-word character, and ASCII words next to Thai text", () => {
    expect(selectRoles(cfg({ keywords: { security: [".env"] } }), "update the .env loading").roles).toContain("security");
    expect(selectRoles(cfg({ keywords: { security: [".env"] } }), "update the .environment page").roles).not.toContain("security");
    expect(selectRoles(cfg({ keywords: { architecture: ["c++"] } }), "port the c++ module").roles).toContain("architecture");
    expect(selectRoles(cfg(), "แก้login bug ให้หน่อย").roles).toContain("security");
    expect(selectRoles(cfg(), "แก้ไขlogin ให้หน่อย").roles).toContain("security");
  });

  it("selects custom roles from auto.keywords, after the built-in ones", () => {
    const base = cfg({ keywords: { docs: ["readme"] }, maxRoles: 6 });
    const config: Config = { ...base, roles: { ...base.roles, docs: { prompt: "docs", needs: [], writes: true } } };
    const s = selectRoles(config, "update the readme and fix the login bug");
    expect(s.roles).toContain("docs");
    expect(s.roles[s.roles.length - 1]).toBe("docs");
    expect(s.reasons.join(" ")).toContain('docs: matched "readme"');
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
