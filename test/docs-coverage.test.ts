import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USAGE } from "../src/cli/usage.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";

const docs = (p: string) => new URL(`../docs/${p}`, import.meta.url);
const read = (p: string) => readFileSync(docs(p), "utf8");

// These tests fail when code changes without the guide pages changing with it.
describe("docs stay in sync with the code", () => {
  it("documents every CLI command in guide/usage.md", () => {
    const commands = USAGE.split("\n")
      .map((l) => /^\s+orch (\w+)/.exec(l)?.[1])
      .filter((c): c is string => Boolean(c));
    expect(commands.length).toBeGreaterThan(3);
    const page = read("guide/usage.md");
    for (const c of commands) expect(page, `orch ${c} is not in guide/usage.md`).toContain(`orch ${c}`);
  });

  it("documents every config key in guide/configuration.md", () => {
    const keys = [
      ...Object.keys(DEFAULT_CONFIG.agents.claude),
      "defaultAgent", "agents", "rules", "match", "agent", "model", "effort", "contexts", "context",
    ];
    const page = read("guide/configuration.md");
    for (const k of keys) expect(page, `\`${k}\` is not in guide/configuration.md`).toContain(`\`${k}\``);
  });

  it("documents the --context flag in guide/usage.md", () => {
    expect(read("guide/usage.md")).toContain("--context");
  });

  it("documents every environment variable in guide/configuration.md", () => {
    const page = read("guide/configuration.md");
    for (const v of ["ORCH_HOME", "ORCH_CONFIG", "ORCH_DEPTH"]) expect(page).toContain(v);
  });

  it("has a Thai page for every English guide page", () => {
    const pages = readdirSync(docs("guide/")).filter((f) => f.endsWith(".md"));
    expect(pages.length).toBeGreaterThan(2);
    for (const f of pages) expect(existsSync(docs(`th/guide/${f}`)), `docs/th/guide/${f}`).toBe(true);
  });
});
