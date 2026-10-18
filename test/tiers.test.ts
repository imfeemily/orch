import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { classifyTier, pickOnlyRoute } from "../src/core/tiers.js";
import type { Config } from "../src/core/types.js";

const cfg = (): Config => structuredClone(DEFAULT_CONFIG);

describe("classifyTier", () => {
  it("puts small mechanical work in the small tier", () => {
    expect(classifyTier("fix a typo in the README").tier).toBe("small");
    expect(classifyTier("rename getUser to fetchUser").tier).toBe("small");
    expect(classifyTier("summarize this log").tier).toBe("small");
    expect(classifyTier("แก้ตัวสะกดผิดใน README").tier).toBe("small");
  });

  it("puts design-heavy or risky work in the large tier", () => {
    expect(classifyTier("refactor the auth module").tier).toBe("large");
    expect(classifyTier("migrate the database to Postgres").tier).toBe("large");
    expect(classifyTier("debug a race condition in the queue").tier).toBe("large");
    expect(classifyTier("ออกแบบสถาปัตยกรรมใหม่").tier).toBe("large");
  });

  it("uses the medium tier for ordinary work, and for anything it cannot tell", () => {
    expect(classifyTier("add a login page").tier).toBe("medium");
    expect(classifyTier("do the thing").tier).toBe("medium");
  });

  it("lets a large keyword beat a small one, and a very long prompt count as large", () => {
    expect(classifyTier("rename the module and refactor its api").tier).toBe("large");
    expect(classifyTier(`fix a typo. ${"context ".repeat(400)}`).tier).toBe("large");
  });

  it("says why", () => {
    expect(classifyTier("fix a typo").reason).toContain("typo");
    expect(classifyTier("do the thing").reason).toContain("no small or large keyword");
  });
});

describe("pickOnlyRoute", () => {
  it("uses the agent's tier settings", () => {
    const r = pickOnlyRoute(cfg(), "claude", "fix a typo");
    expect(r.route).toEqual({ agent: "claude", model: "haiku", effort: "low", context: "lean", write: true });
    expect(r.tier).toBe("small");
    expect(pickOnlyRoute(cfg(), "claude", "refactor the auth module").route).toMatchObject({ agent: "claude", model: "opus", effort: "high" });
    expect(pickOnlyRoute(cfg(), "claude", "add a login page").route).toMatchObject({ agent: "claude", model: "sonnet" });
  });

  it("gives Codex effort tiers without inventing model names", () => {
    const small = pickOnlyRoute(cfg(), "codex", "fix a typo").route;
    expect(small).toMatchObject({ agent: "codex", effort: "low", context: "lean" });
    expect(small.model).toBeUndefined();
    expect(pickOnlyRoute(cfg(), "codex", "refactor the auth module").route).toMatchObject({ agent: "codex", effort: "high" });
  });

  it("never routes to the other agent, whatever a rule says", () => {
    const c = cfg();
    c.rules = [{ match: "typo", agent: "codex", model: "x" }];
    expect(pickOnlyRoute(c, "claude", "fix a typo").route.agent).toBe("claude");
  });

  it("lets a matching rule for the same agent override the tier's fields", () => {
    const c = cfg();
    c.rules = [{ match: "typo", agent: "claude", model: "opus" }];
    expect(pickOnlyRoute(c, "claude", "fix a typo").route).toMatchObject({ model: "opus", effort: "low" });
  });

  it("lets the run edit files by default, and a tier can turn that off", () => {
    expect(pickOnlyRoute(cfg(), "claude", "fix a typo").route.write).toBe(true);
    const c = cfg();
    c.tiers.claude.large = { ...c.tiers.claude.large, write: false };
    expect(pickOnlyRoute(c, "claude", "refactor the auth module").route.write).toBe(false);
  });

  it("uses the user's own tier settings", () => {
    const c = cfg();
    c.tiers.claude.large = { model: "sonnet", effort: "max" };
    expect(pickOnlyRoute(c, "claude", "refactor it").route).toMatchObject({ agent: "claude", model: "sonnet", effort: "max" });
  });
});
