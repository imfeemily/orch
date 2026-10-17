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

  it("keeps a 0.2.x config in text mode: args without a JSON flag infer output text", () => {
    const cfg = loadConfig(
      tmpFile('agents:\n  claude:\n    args: ["-p", "--", "{prompt}"]\n  codex:\n    args: ["exec", "--", "{prompt}"]\n'),
    );
    expect(cfg.agents.claude.output).toBe("text");
    expect(cfg.agents.codex.output).toBe("text");
  });

  it("infers the JSON kinds from the flags in the user's args", () => {
    const cfg = loadConfig(
      tmpFile(
        'agents:\n  claude:\n    args: ["-p", "--output-format", "json", "--", "{prompt}"]\n  codex:\n    args: ["exec", "--json", "--", "{prompt}"]\n',
      ),
    );
    expect(cfg.agents.claude.output).toBe("claude-json");
    expect(cfg.agents.codex.output).toBe("codex-jsonl");
  });

  it("respects an explicit output even when args are overridden", () => {
    const cfg = loadConfig(tmpFile('agents:\n  claude:\n    args: ["-p", "--", "{prompt}"]\n    output: claude-json\n'));
    expect(cfg.agents.claude.output).toBe("claude-json");
  });

  it("defaults to JSON output for both agents", () => {
    expect(DEFAULT_CONFIG.agents.claude.output).toBe("claude-json");
    expect(DEFAULT_CONFIG.agents.codex.output).toBe("codex-jsonl");
    expect(DEFAULT_CONFIG.agents.claude.args).toContain("--output-format");
    expect(DEFAULT_CONFIG.agents.codex.args).toContain("--json");
  });

  it("accepts output: text and rejects an unknown output kind", () => {
    expect(loadConfig(tmpFile("agents:\n  claude:\n    output: text\n")).agents.claude.output).toBe("text");
    expect(() => loadConfig(tmpFile("agents:\n  claude:\n    output: yaml\n"))).toThrow(/output/);
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

  it("ships lean and minimal context presets for both agents", () => {
    for (const name of ["lean", "minimal"]) {
      expect(DEFAULT_CONFIG.contexts[name].claude!.length).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.contexts[name].codex!.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_CONFIG.contexts.lean.claude).toContain("--setting-sources");
    expect(DEFAULT_CONFIG.contexts.minimal.claude).toContain("--safe-mode");
  });

  it("merges user context presets over the defaults by name", () => {
    const cfg = loadConfig(
      tmpFile('contexts:\n  mine:\n    claude: ["--disable-slash-commands"]\n  lean:\n    codex: ["--disable", "hooks"]\n'),
    );
    expect(cfg.contexts.mine.claude).toEqual(["--disable-slash-commands"]);
    expect(cfg.contexts.lean.codex).toEqual(["--disable", "hooks"]);
    expect(cfg.contexts.minimal).toEqual(DEFAULT_CONFIG.contexts.minimal);
  });

  it("rejects a rule that names an unknown context", () => {
    expect(() => loadConfig(tmpFile('rules:\n  - match: x\n    agent: claude\n    context: nope\n'))).toThrow(/context.*nope/);
  });

  it("rejects malformed context presets", () => {
    expect(() => loadConfig(tmpFile('contexts:\n  bad:\n    gemini: ["--x"]\n'))).toThrow(/contexts\.bad/);
    expect(() => loadConfig(tmpFile('contexts:\n  bad:\n    claude: "--x"\n'))).toThrow(/contexts\.bad/);
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
