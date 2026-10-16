import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { otherAgent, pickAgent, pickRoute } from "../src/core/router.js";
import type { Config } from "../src/core/types.js";

const withModels: Config = {
  ...DEFAULT_CONFIG,
  rules: [{ match: "typo", agent: "codex", model: "gpt-6-luna", effort: "low" }],
};

const none = () => false;

describe("pickAgent", () => {
  it("uses the default agent when no rule matches", () => {
    expect(pickAgent(DEFAULT_CONFIG, "add a login page", none)).toBe("claude");
  });

  it("applies the first matching rule, case-insensitively", () => {
    expect(pickAgent(DEFAULT_CONFIG, "Fix a TYPO in README", none)).toBe("codex");
    expect(pickAgent(DEFAULT_CONFIG, "Refactor the auth module", none)).toBe("claude");
  });

  it("falls back to the other agent when the preferred one is cooling", () => {
    expect(pickAgent(DEFAULT_CONFIG, "fix typo", (a) => a === "codex")).toBe("claude");
  });

  it("returns null when both are cooling", () => {
    expect(pickAgent(DEFAULT_CONFIG, "anything", () => true)).toBeNull();
  });
});

describe("pickRoute", () => {
  it("carries the rule's model and effort to its agent", () => {
    expect(pickRoute(withModels, "fix typo", none)).toEqual({ agent: "codex", model: "gpt-6-luna", effort: "low" });
  });

  it("drops model and effort when the rule's agent is cooling and the other agent is used", () => {
    expect(pickRoute(withModels, "fix typo", (a) => a === "codex")).toEqual({ agent: "claude" });
  });

  it("has no model when no rule matches", () => {
    expect(pickRoute(withModels, "build a page", none)).toEqual({ agent: "claude" });
  });

  it("returns null when both agents are cooling", () => {
    expect(pickRoute(withModels, "fix typo", () => true)).toBeNull();
  });
});

describe("otherAgent", () => {
  it("flips", () => {
    expect(otherAgent("claude")).toBe("codex");
    expect(otherAgent("codex")).toBe("claude");
  });
});
