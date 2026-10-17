import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.js";

describe("parseArgs", () => {
  it("joins the words of a run prompt", () => {
    expect(parseArgs(["run", "fix", "the", "bug"])).toEqual({
      name: "run",
      prompt: "fix the bug",
      cwd: undefined,
    });
  });

  it("reads --cwd", () => {
    expect(parseArgs(["run", "--cwd", "/tmp/x", "do it"])).toEqual({
      name: "run",
      prompt: "do it",
      cwd: "/tmp/x",
    });
  });

  it("requires a prompt", () => {
    expect(() => parseArgs(["run"])).toThrow(/usage/);
  });

  it("requires a value for --cwd", () => {
    expect(() => parseArgs(["run", "x", "--cwd"])).toThrow(/--cwd/);
  });

  it("parses status and daemon", () => {
    expect(parseArgs(["status"])).toEqual({ name: "status" });
    expect(parseArgs(["daemon", "stop"])).toEqual({ name: "daemon", action: "stop" });
  });

  it("parses the role flags for run", () => {
    expect(parseArgs(["run", "--role", "reviewer", "check", "it"])).toMatchObject({ name: "run", prompt: "check it", role: "reviewer" });
    expect(parseArgs(["run", "--roles", "developer,tester", "x"])).toMatchObject({ roles: ["developer", "tester"] });
    expect(parseArgs(["run", "--team", "standard", "--dry-run", "--require-codex", "--keep-going", "x"])).toMatchObject({
      team: "standard", dryRun: true, requireCodex: true, keepGoing: true,
    });
  });

  it("rejects role flags without a value and conflicting selectors", () => {
    expect(() => parseArgs(["run", "x", "--role"])).toThrow(/--role/);
    expect(() => parseArgs(["run", "--roles", "", "x"])).toThrow(/--roles/);
    expect(() => parseArgs(["run", "--role", "a", "--team", "b", "x"])).toThrow(/--role.*--team/);
  });

  it("accepts --by role for usage", () => {
    expect(parseArgs(["usage", "--by", "role"])).toEqual({ name: "usage", since: "24h", by: "role" });
  });

  it("parses --auto, --no-auto and explain", () => {
    expect(parseArgs(["run", "--auto", "fix", "it"])).toMatchObject({ name: "run", prompt: "fix it", auto: true });
    expect(parseArgs(["run", "--no-auto", "fix", "it"])).toMatchObject({ auto: false });
    expect(parseArgs(["explain", "fix", "the", "login"])).toEqual({ name: "explain", prompt: "fix the login" });
    expect(() => parseArgs(["explain"])).toThrow(/explain/);
  });

  it("rejects --auto with a selector or with --no-auto, naming both flags", () => {
    expect(() => parseArgs(["run", "--auto", "--team", "standard", "x"])).toThrow(/--auto.*--team/);
    expect(() => parseArgs(["run", "--auto", "--no-auto", "x"])).toThrow(/--auto.*--no-auto/);
  });

  it("parses --context for run", () => {
    expect(parseArgs(["run", "--context", "lean", "fix", "it"])).toEqual({
      name: "run", prompt: "fix it", cwd: undefined, context: "lean",
    });
    expect(() => parseArgs(["run", "x", "--context"])).toThrow(/--context/);
  });

  it("accepts --by context for usage", () => {
    expect(parseArgs(["usage", "--by", "context"])).toEqual({ name: "usage", since: "24h", by: "context" });
  });

  it("parses usage with defaults and options", () => {
    expect(parseArgs(["usage"])).toEqual({ name: "usage", since: "24h", by: "agent" });
    expect(parseArgs(["usage", "--since", "7d", "--by", "model"])).toEqual({ name: "usage", since: "7d", by: "model" });
  });

  it("rejects a bad --by or --since for usage", () => {
    expect(() => parseArgs(["usage", "--by", "tier"])).toThrow(/agent.*model/);
    expect(() => parseArgs(["usage", "--since", "abc"])).toThrow(/--since/);
    expect(() => parseArgs(["usage", "--nope"])).toThrow(/unknown option/);
  });

  it("parses init", () => {
    expect(parseArgs(["init"])).toEqual({ name: "init" });
  });

  it("shows help with no args and rejects unknown commands", () => {
    expect(parseArgs([])).toEqual({ name: "help" });
    expect(() => parseArgs(["nope"])).toThrow(/unknown command/);
  });
});
