import { describe, expect, it } from "vitest";
import { USAGE } from "../src/cli/usage.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { renderCliReference, renderConfigReference } from "../scripts/reference.js";

describe("renderConfigReference", () => {
  const md = renderConfigReference(DEFAULT_CONFIG);

  it("documents every agent with its command and flags", () => {
    for (const name of ["claude", "codex"] as const) {
      expect(md).toContain(`## ${name}`);
      const a = DEFAULT_CONFIG.agents[name];
      expect(md).toContain(a.command);
      for (const arg of [...a.args, ...(a.modelArgs ?? []), ...(a.effortArgs ?? [])]) {
        expect(md).toContain(arg);
      }
    }
  });

  it("lists limit and auth patterns", () => {
    const a = DEFAULT_CONFIG.agents.claude;
    for (const p of [...a.limitPatterns, ...a.authPatterns]) expect(md).toContain(p);
  });

  it("lists the default routing rules", () => {
    for (const rule of DEFAULT_CONFIG.rules) expect(md).toContain(rule.match);
  });

  it("lists the roles and teams", () => {
    expect(md).toContain("Roles");
    for (const name of [...Object.keys(DEFAULT_CONFIG.roles), ...Object.keys(DEFAULT_CONFIG.teams)]) {
      expect(md).toContain(name);
    }
  });

  it("lists the context presets", () => {
    expect(md).toContain("Context presets");
    for (const name of Object.keys(DEFAULT_CONFIG.contexts)) expect(md).toContain(name);
    expect(md).toContain("--setting-sources");
  });

  it("documents the environment variables", () => {
    for (const v of ["ORCH_HOME", "ORCH_CONFIG", "ORCH_DEPTH"]) expect(md).toContain(v);
  });

  it("never prints undefined", () => {
    expect(md).not.toContain("undefined");
  });
});

describe("renderCliReference", () => {
  it("includes every usage line in a code block", () => {
    const md = renderCliReference(USAGE);
    expect(md).toContain("```");
    for (const line of USAGE.split("\n")) expect(md).toContain(line.trimEnd());
  });
});
