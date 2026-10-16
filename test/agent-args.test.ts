import { describe, expect, it } from "vitest";
import { buildAgentArgs } from "../src/core/agent-args.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";

const claude = DEFAULT_CONFIG.agents.claude;
const codex = DEFAULT_CONFIG.agents.codex;

describe("buildAgentArgs", () => {
  it("returns the plain args when no model or effort is requested", () => {
    expect(buildAgentArgs(claude, {})).toEqual(claude.args);
  });

  it("inserts model flags before the -- that guards the prompt", () => {
    expect(buildAgentArgs(claude, { model: "sonnet" })).toEqual(["-p", "--model", "sonnet", "--", "{prompt}"]);
  });

  it("inserts model and effort for codex", () => {
    expect(buildAgentArgs(codex, { model: "gpt-6-luna", effort: "low" })).toEqual([
      "exec", "-m", "gpt-6-luna", "-c", 'model_reasoning_effort="low"', "--", "{prompt}",
    ]);
  });

  it("inserts before the prompt placeholder when args have no --", () => {
    const cfg = { ...claude, args: ["-p", "{prompt}"] };
    expect(buildAgentArgs(cfg, { effort: "low" })).toEqual(["-p", "--effort", "low", "{prompt}"]);
  });

  it("ignores a model when the agent has no modelArgs template", () => {
    const cfg = { ...claude, modelArgs: undefined };
    expect(buildAgentArgs(cfg, { model: "x" })).toEqual(claude.args);
  });
});
