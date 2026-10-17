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
