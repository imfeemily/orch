import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { buildRolePrompt, capHandoffs, extractHandoff, planRoles } from "../src/core/roles.js";

const cfg = DEFAULT_CONFIG;

describe("planRoles", () => {
  it("plans a single role", () => {
    expect(planRoles(cfg, { role: "reviewer" })).toEqual({ names: ["reviewer"] });
  });

  it("orders a team canonically even when the team lists roles differently", () => {
    const config = { ...cfg, teams: { odd: ["reviewer", "developer", "tester"] } };
    expect(planRoles(config, { team: "odd" })).toEqual({ names: ["developer", "tester", "reviewer"] });
    expect(planRoles(cfg, { team: "standard" })).toEqual({ names: ["developer", "tester", "reviewer"] });
  });

  it("keeps the given order for --roles and removes duplicates", () => {
    expect(planRoles(cfg, { roles: ["reviewer", "developer", "reviewer"] })).toEqual({ names: ["reviewer", "developer"] });
  });

  it("requires exactly one selector", () => {
    expect(planRoles(cfg, {})).toMatchObject({ error: expect.stringContaining("--role, --roles or --team") });
    const both = planRoles(cfg, { role: "reviewer", team: "standard" });
    expect(both).toMatchObject({ error: expect.stringContaining("--role") });
    expect((both as { error: string }).error).toContain("--team");
  });

  it("rejects unknown names and lists the valid ones", () => {
    const role = planRoles(cfg, { role: "wizard" }) as { error: string };
    expect(role.error).toContain("wizard");
    expect(role.error).toContain("developer");
    const team = planRoles(cfg, { team: "huge" }) as { error: string };
    expect(team.error).toContain("standard");
    expect(planRoles(cfg, { roles: ["developer", "nope"] })).toMatchObject({ error: expect.stringContaining("nope") });
    expect(planRoles(cfg, { roles: [] })).toMatchObject({ error: expect.any(String) });
  });
});

describe("buildRolePrompt", () => {
  const role = cfg.roles.reviewer;

  it("puts the role prompt first, then the task", () => {
    const p = buildRolePrompt(role, "add a clamp test", [], false);
    expect(p.startsWith(role.prompt)).toBe(true);
    expect(p).toContain("## Task\nadd a clamp test");
    expect(p).not.toContain("## Earlier roles");
    expect(p).not.toContain("## Handoff");
  });

  it("adds earlier roles' handoffs and the handoff instruction when asked", () => {
    const p = buildRolePrompt(role, "t", [{ role: "developer", text: "changed math.ts" }], true);
    expect(p).toContain("## Earlier roles\n### developer\nchanged math.ts");
    expect(p).toContain('"## Handoff"');
    expect(p).toContain("150 words");
  });
});

describe("extractHandoff", () => {
  it("returns the text under the last Handoff heading, up to the next heading", () => {
    const out = "work\n## Handoff\nold\n## Handoff\nfinal note\nmore\n## Other\nignored";
    expect(extractHandoff(out)).toBe("final note\nmore");
  });

  it("falls back to the last 1,500 characters when there is no Handoff section", () => {
    const out = `${"a".repeat(3000)}END`;
    const h = extractHandoff(out);
    expect(h.length).toBeLessThanOrEqual(1500);
    expect(h.endsWith("END")).toBe(true);
  });

  it("falls back when the Handoff section is empty, and handles an empty output", () => {
    expect(extractHandoff("body text\n## Handoff\n")).toBe("body text");
    expect(extractHandoff("")).toBe("");
  });
});

describe("capHandoffs", () => {
  const long = (role: string, ch: string) => ({ role, text: ch.repeat(3000) });

  it("keeps the newest handoff whole and truncates older ones to the budget", () => {
    const out = capHandoffs([long("a", "x"), long("b", "y")], 4000);
    expect(out.map((h) => h.role)).toEqual(["a", "b"]);
    expect(out[1].text).toHaveLength(3000);
    expect(out[0].text).toHaveLength(1000);
  });

  it("drops older handoffs once the budget is spent, and returns nothing for a zero budget", () => {
    expect(capHandoffs([long("a", "x"), long("b", "y")], 3000).map((h) => h.role)).toEqual(["b"]);
    expect(capHandoffs([long("a", "x")], 0)).toEqual([]);
  });

  it("truncates a single handoff larger than the budget", () => {
    expect(capHandoffs([long("a", "x")], 500)[0].text).toHaveLength(500);
  });
});
