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

  it("ships six roles and the quick, standard and full teams", () => {
    expect(Object.keys(DEFAULT_CONFIG.roles).sort()).toEqual(["architecture", "designer", "developer", "reviewer", "security", "tester"]);
    expect(DEFAULT_CONFIG.roles.developer.writes).toBe(true);
    expect(DEFAULT_CONFIG.roles.developer.agentArgs?.claude).toEqual(["--permission-mode", "acceptEdits"]);
    expect(DEFAULT_CONFIG.roles.reviewer).toMatchObject({ context: "lean", writes: false, needs: [] });
    expect(DEFAULT_CONFIG.teams).toEqual({
      quick: ["developer"],
      standard: ["developer", "tester", "reviewer"],
      full: ["architecture", "designer", "developer", "tester", "reviewer", "security"],
    });
    expect(DEFAULT_CONFIG.pipeline.handoffChars).toBe(4000);
  });

  it("pins the designer to codex with image capability and a writable sandbox for its assets", () => {
    const d = DEFAULT_CONFIG.roles.designer;
    expect(d).toMatchObject({ needs: ["image"], agent: "codex", writes: false });
    expect(d.agentArgs?.codex).toEqual(["-s", "workspace-write"]);
    for (const name of ["architecture", "security"]) {
      expect(DEFAULT_CONFIG.roles[name]).toMatchObject({ context: "lean", writes: false, needs: [] });
    }
  });

  it("ships auto selection off, capped at three roles, and merges user settings", () => {
    expect(DEFAULT_CONFIG.auto).toEqual({ enabled: false, maxRoles: 3 });
    const cfg = loadConfig(tmpFile("auto:\n  enabled: true\n  maxRoles: 2\n  keywords:\n    security: [pii]\n"));
    expect(cfg.auto).toEqual({ enabled: true, maxRoles: 2, keywords: { security: ["pii"] } });
    expect(loadConfig(tmpFile("auto:\n  maxRoles: 5\n")).auto).toEqual({ enabled: false, maxRoles: 5 });
  });

  it("rejects unsafe role names, empty teams, non-mapping roles and a bad auto block", () => {
    const bad = (yaml: string, re: RegExp) => expect(() => loadConfig(tmpFile(yaml))).toThrow(re);
    bad("roles:\n  ../x:\n    prompt: p\n", /role name/);
    bad("roles:\n  a/b:\n    prompt: p\n", /role name/);
    bad("teams:\n  t: []\n", /teams\.t.*at least one/);
    bad("roles:\n  reviewer: just some text\n", /roles\.reviewer.*mapping/);
    bad('auto:\n  enabled: "yes"\n', /auto\.enabled/);
    bad("auto:\n  maxRoles: 0\n", /auto\.maxRoles/);
    bad("auto:\n  keywords:\n    wizard: [x]\n", /auto\.keywords.*wizard/);
    bad("auto:\n  keywords:\n    security: pii\n", /auto\.keywords\.security/);
  });

  it("ships parallel read-only roles on with at most two at once, and merges user pipeline settings", () => {
    expect(DEFAULT_CONFIG.pipeline).toEqual({ handoffChars: 4000, parallel: true, maxParallel: 2 });
    const cfg = loadConfig(tmpFile("pipeline:\n  parallel: false\n  maxParallel: 3\n"));
    expect(cfg.pipeline).toEqual({ handoffChars: 4000, parallel: false, maxParallel: 3 });
  });

  it("rejects an invalid pipeline.parallel or pipeline.maxParallel", () => {
    const bad = (yaml: string, re: RegExp) => expect(() => loadConfig(tmpFile(yaml))).toThrow(re);
    bad('pipeline:\n  parallel: "yes"\n', /pipeline\.parallel/);
    bad("pipeline:\n  maxParallel: 0\n", /pipeline\.maxParallel/);
    bad("pipeline:\n  maxParallel: 1.5\n", /pipeline\.maxParallel/);
    bad("pipeline:\n  threads: 2\n", /pipeline\.threads/);
  });

  it("treats a role you add as one that may change files unless you say otherwise, so it never runs in parallel by accident", () => {
    const cfg = loadConfig(tmpFile("roles:\n  docs:\n    prompt: update the README\n  audit:\n    prompt: look only\n    writes: false\n"));
    expect(cfg.roles.docs.writes).toBe(true);
    expect(cfg.roles.audit.writes).toBe(false);
    expect(cfg.roles.reviewer.writes).toBe(false); // built-in values are unchanged
  });

  it("rejects a timeoutSec too large for a timer", () => {
    expect(() => loadConfig(tmpFile("agents:\n  claude:\n    timeoutSec: 3000000\n"))).toThrow(/timeoutSec/);
  });

  it("has built-in tiers per agent, merges user tiers per key, and rejects bad ones", () => {
    const d = loadConfig(tmpFile("defaultAgent: claude\n"));
    expect(d.tiers.claude.small).toMatchObject({ model: "haiku", effort: "low", context: "lean" });
    const m = loadConfig(tmpFile("tiers:\n  claude:\n    large:\n      model: sonnet\n"));
    expect(m.tiers.claude.large).toMatchObject({ model: "sonnet", effort: "high" });
    expect(m.tiers.claude.small.model).toBe("haiku");
    expect(() => loadConfig(tmpFile("tiers:\n  claude:\n    huge: {}\n"))).toThrow(/tiers\.claude\.huge/);
    expect(() => loadConfig(tmpFile("tiers:\n  gemini: {}\n"))).toThrow(/tiers\.gemini/);
    expect(() => loadConfig(tmpFile("tiers:\n  claude:\n    small:\n      context: nope\n"))).toThrow(/unknown context/);
    expect(() => loadConfig(tmpFile("tiers:\n  claude:\n    small: 3\n"))).toThrow(/tiers\.claude\.small/);
  });

  it("accepts a positive agent timeoutSec and rejects anything else", () => {
    expect(loadConfig(tmpFile("agents:\n  claude:\n    timeoutSec: 600\n")).agents.claude.timeoutSec).toBe(600);
    for (const v of ["0", "-5", "soon"]) {
      expect(() => loadConfig(tmpFile(`agents:\n  claude:\n    timeoutSec: ${v}\n`))).toThrow(/timeoutSec/);
    }
  });

  it("rejects an auto or pipeline block that is not a mapping, unknown keys, and non-mapping keywords", () => {
    const bad = (yaml: string, re: RegExp) => expect(() => loadConfig(tmpFile(yaml))).toThrow(re);
    bad("auto: true\n", /auto must be a mapping/);
    bad("auto: [a, b]\n", /auto must be a mapping/);
    bad("auto:\n  max_roles: 1\n", /auto\.max_roles/);
    bad("auto:\n  keywords: []\n", /auto\.keywords/);
    bad("pipeline: true\n", /pipeline must be a mapping/);
    bad("pipeline:\n  handoff: 10\n", /pipeline\.handoff/);
  });

  it("merges user roles and teams over the defaults by name and key", () => {
    const cfg = loadConfig(
      tmpFile(
        'roles:\n  mine:\n    prompt: hi\n  reviewer:\n    model: haiku\nteams:\n  docs: [reviewer]\n',
      ),
    );
    expect(cfg.roles.mine).toEqual({ prompt: "hi", needs: [], writes: true });
    expect(cfg.roles.reviewer).toMatchObject({ model: "haiku", context: "lean", writes: false });
    expect(cfg.roles.reviewer.prompt).toBe(DEFAULT_CONFIG.roles.reviewer.prompt);
    expect(cfg.teams.docs).toEqual(["reviewer"]);
    expect(cfg.teams.standard).toEqual(DEFAULT_CONFIG.teams.standard);
  });

  it("rejects invalid roles, teams and pipeline settings, naming the key", () => {
    const bad = (yaml: string, re: RegExp) => expect(() => loadConfig(tmpFile(yaml))).toThrow(re);
    bad("roles:\n  x:\n    writes: false\n", /roles\.x\.prompt/);
    bad("roles:\n  x:\n    prompt: p\n    agent: gemini\n", /roles\.x\.agent/);
    bad("roles:\n  x:\n    prompt: p\n    context: nope\n", /roles\.x\.context/);
    bad("roles:\n  x:\n    prompt: p\n    needs: [video]\n", /roles\.x\.needs/);
    bad("roles:\n  x:\n    prompt: p\n    needs: [image]\n    agent: claude\n", /roles\.x.*image/);
    bad("teams:\n  t: [nope]\n", /teams\.t.*nope/);
    bad("pipeline:\n  handoffChars: 0\n", /handoffChars/);
    bad('pipeline:\n  handoffChars: "x"\n', /handoffChars/);
  });

  it("accepts an image role without an agent (it is pinned to codex at run time)", () => {
    const cfg = loadConfig(tmpFile("roles:\n  pic:\n    prompt: p\n    needs: [image]\n"));
    expect(cfg.roles.pic.needs).toEqual(["image"]);
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
