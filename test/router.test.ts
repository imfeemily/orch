import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { otherAgent, pickAgent, pickRoleRoute, pickRoute } from "../src/core/router.js";
import type { RoleConfig } from "../src/core/types.js";
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

const withContext: Config = {
  ...DEFAULT_CONFIG,
  rules: [{ match: "typo", agent: "codex", model: "gpt-6-luna", context: "lean" }],
};

describe("pickRoute context", () => {
  it("carries the rule's context", () => {
    expect(pickRoute(withContext, "fix typo", none)).toEqual({ agent: "codex", model: "gpt-6-luna", context: "lean" });
  });

  it("keeps the context name (but drops the model) when the other agent is used", () => {
    expect(pickRoute(withContext, "fix typo", (a) => a === "codex")).toEqual({ agent: "claude", context: "lean" });
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

describe("pickRoleRoute", () => {
  const role = (over: Partial<RoleConfig> = {}): RoleConfig => ({ prompt: "p", needs: [], writes: false, ...over });

  it("uses the role's agent, model, effort and context", () => {
    const r = role({ agent: "codex", model: "gpt-6-luna", effort: "low", context: "lean" });
    expect(pickRoleRoute(DEFAULT_CONFIG, r, "task", () => false)).toEqual({
      agent: "codex", model: "gpt-6-luna", effort: "low", context: "lean",
    });
  });

  it("falls back to normal routing for the agent when the role does not pin one", () => {
    expect(pickRoleRoute(DEFAULT_CONFIG, role(), "add a page", () => false)).toEqual({ agent: "claude" });
    expect(pickRoleRoute(DEFAULT_CONFIG, role(), "fix a typo", () => false)).toEqual({ agent: "codex" });
  });

  it("moves to the other agent when the preferred one is cooling, keeping only the context", () => {
    const r = role({ agent: "claude", model: "haiku", context: "lean" });
    expect(pickRoleRoute(DEFAULT_CONFIG, r, "t", (a) => a === "claude")).toEqual({ agent: "codex", context: "lean" });
    expect(pickRoleRoute(DEFAULT_CONFIG, r, "t", () => true)).toBeNull();
  });

  it("pins a role that needs a capability to codex and never moves it", () => {
    const r = role({ needs: ["image"] });
    expect(pickRoleRoute(DEFAULT_CONFIG, r, "t", () => false)).toEqual({ agent: "codex" });
    expect(pickRoleRoute(DEFAULT_CONFIG, r, "t", (a) => a === "codex")).toBeNull();
  });
});
