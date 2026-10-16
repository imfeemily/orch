import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_CONFIG, initConfig, loadConfig } from "../src/core/config.js";

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

  it("accepts a rule with model and effort", () => {
    const cfg = loadConfig(
      tmpFile('rules:\n  - match: "typo"\n    agent: codex\n    model: gpt-6-luna\n    effort: low\n'),
    );
    expect(cfg.rules[0]).toEqual({ match: "typo", agent: "codex", model: "gpt-6-luna", effort: "low" });
  });

  it("rejects a rule model when the agent has no modelArgs", () => {
    expect(() =>
      loadConfig(
        tmpFile('agents:\n  codex:\n    modelArgs: []\nrules:\n  - match: x\n    agent: codex\n    model: m\n'),
      ),
    ).toThrow(/modelArgs/);
  });

  it("rejects an invalid auth pattern", () => {
    expect(() =>
      loadConfig(tmpFile('agents:\n  claude:\n    authPatterns: ["("]\n')),
    ).toThrow(/not a valid regex/);
  });

  it("rejects an invalid limit pattern", () => {
    expect(() =>
      loadConfig(tmpFile('agents:\n  codex:\n    limitPatterns: ["("]\n')),
    ).toThrow(/not a valid regex/);
  });
});

describe("initConfig", () => {
  it("writes a loadable default config and never overwrites", () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-"));
    const file = join(dir, "sub", "config.yaml");
    expect(initConfig(file)).toBe("created");
    expect(existsSync(file)).toBe(true);
    expect(loadConfig(file)).toEqual(DEFAULT_CONFIG);

    writeFileSync(file, "defaultAgent: codex\n");
    expect(initConfig(file)).toBe("exists");
    expect(readFileSync(file, "utf8")).toBe("defaultAgent: codex\n");
  });
});
