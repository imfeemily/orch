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

  it("shows help with no args and rejects unknown commands", () => {
    expect(parseArgs([])).toEqual({ name: "help" });
    expect(() => parseArgs(["nope"])).toThrow(/unknown command/);
  });
});
