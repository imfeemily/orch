import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/core/config.js";

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const file = join(dir, "config.yaml");
  writeFileSync(file, content);
  return file;
}

describe("loadConfig", () => {
  it("returns defaults when the file is missing", () => {
    expect(loadConfig("/nonexistent/config.yaml")).toEqual(DEFAULT_CONFIG);
  });

  it("merges overrides onto defaults", () => {
    const cfg = loadConfig(
      tmpFile("defaultAgent: codex\nagents:\n  claude:\n    command: /opt/claude\n"),
    );
    expect(cfg.defaultAgent).toBe("codex");
    expect(cfg.agents.claude.command).toBe("/opt/claude");
    expect(cfg.agents.claude.args).toEqual(DEFAULT_CONFIG.agents.claude.args);
    expect(cfg.agents.codex).toEqual(DEFAULT_CONFIG.agents.codex);
  });

  it("passes the prompt after -- so a leading dash is not parsed as a flag", () => {
    for (const name of ["claude", "codex"] as const) {
      const a = DEFAULT_CONFIG.agents[name];
      for (const args of [a.args, a.summaryArgs!]) {
        expect(args[args.indexOf("{prompt}") - 1]).toBe("--");
      }
    }
  });

  it("rejects an unknown defaultAgent", () => {
    expect(() => loadConfig(tmpFile("defaultAgent: gemini\n"))).toThrow(/defaultAgent/);
  });

  it("rejects a rule with an invalid regex", () => {
    expect(() =>
      loadConfig(tmpFile('rules:\n  - match: "("\n    agent: claude\n')),
    ).toThrow(/not a valid regex/);
  });

  it("rejects an invalid limit pattern", () => {
    expect(() =>
      loadConfig(tmpFile('agents:\n  codex:\n    limitPatterns: ["("]\n')),
    ).toThrow(/not a valid regex/);
  });
});
