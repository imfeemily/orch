import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { otherAgent, pickAgent } from "../src/core/router.js";

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

describe("otherAgent", () => {
  it("flips", () => {
    expect(otherAgent("claude")).toBe("codex");
    expect(otherAgent("codex")).toBe("claude");
  });
});
