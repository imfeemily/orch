import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { type CommandRunner, contextBlocks, createReadinessChecker } from "../src/core/readiness.js";

type Reply = { exitCode: number | null; stdout?: string };

function fakeRunner(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const run: CommandRunner = async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    const r = replies[key];
    return { exitCode: r?.exitCode ?? null, stdout: r?.stdout ?? "" };
  };
  return { run, calls };
}

const CODEX_FEATURES = "apps  stable  true\nimage_generation  stable  true\nhooks  stable  true\n";
const goodCodex = {
  "codex --version": { exitCode: 0 },
  "codex login status": { exitCode: 0, stdout: "Logged in using ChatGPT" },
  "codex features list": { exitCode: 0, stdout: CODEX_FEATURES },
};
const goodClaude = {
  "claude --version": { exitCode: 0 },
  "claude auth status": { exitCode: 0, stdout: '{"loggedIn": true}' },
};

const make = (replies: Record<string, Reply>, over: Partial<Parameters<typeof createReadinessChecker>[0]> = {}) => {
  const r = fakeRunner(replies);
  const check = createReadinessChecker({ config: DEFAULT_CONFIG, isCooling: () => false, run: r.run, ...over });
  return { check, calls: r.calls };
};

describe("createReadinessChecker", () => {
  it("is ready when installed and logged in", async () => {
    expect((await make(goodClaude).check("claude")).ready).toBe(true);
    expect((await make(goodCodex).check("codex")).ready).toBe(true);
  });

  it("reports an agent that is not installed and skips the other checks", async () => {
    const m = make({ "codex --version": { exitCode: null } });
    expect(await m.check("codex")).toEqual({ ready: false, reasons: ["not installed"] });
    expect(m.calls).toEqual(["codex --version"]);
  });

  it("reports a missing login with the fix", async () => {
    const c = await make({ ...goodClaude, "claude auth status": { exitCode: 0, stdout: '{"loggedIn": false}' } }).check("claude");
    expect(c.reasons).toEqual(["not logged in: run `claude`, then /login"]);
    const x = await make({ ...goodCodex, "codex login status": { exitCode: 1 } }).check("codex");
    expect(x.reasons).toEqual(["not logged in: run `codex login`"]);
  });

  it("treats unparsable claude auth output as not logged in", async () => {
    const c = await make({ ...goodClaude, "claude auth status": { exitCode: 0, stdout: "garbage" } }).check("claude");
    expect(c.ready).toBe(false);
  });

  it("checks image generation for codex and never supports it on claude", async () => {
    expect((await make(goodCodex).check("codex", ["image"])).ready).toBe(true);
    const off = await make({ ...goodCodex, "codex features list": { exitCode: 0, stdout: "image_generation  stable  false\n" } }).check("codex", ["image"]);
    expect(off.reasons).toEqual(["image generation is disabled in codex features"]);
    const claude = await make(goodClaude).check("claude", ["image"]);
    expect(claude.reasons).toEqual(["claude cannot generate images"]);
  });

  it("does not ask for features when no capability is needed", async () => {
    const m = make(goodCodex);
    await m.check("codex");
    expect(m.calls).not.toContain("codex features list");
  });

  it("is not ready while cooling down, evaluated live", async () => {
    let cooling = true;
    const m = make(goodCodex, { isCooling: () => cooling });
    expect((await m.check("codex")).reasons).toContain("cooling down");
    cooling = false;
    expect((await m.check("codex")).ready).toBe(true);
  });

  it("uses the configured command name", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.agents.codex.command = "/opt/codex";
    const m = make({ "/opt/codex --version": { exitCode: 0 }, "/opt/codex login status": { exitCode: 0 } }, { config });
    expect((await m.check("codex")).ready).toBe(true);
  });

  it("caches the install and login results for the ttl", async () => {
    let t = 1000;
    const m = make(goodCodex, { ttlMs: 60_000, now: () => t });
    await m.check("codex");
    const first = m.calls.length;
    await m.check("codex");
    expect(m.calls.length).toBe(first);
    t += 61_000;
    await m.check("codex");
    expect(m.calls.length).toBe(first * 2);
  });
});

describe("contextBlocks", () => {
  it("blocks an image role when the preset disables image generation", () => {
    expect(contextBlocks(["--disable", "hooks", "--disable", "image_generation"], ["image"])).toBe(
      "context preset disables image generation",
    );
  });

  it("understands the other ways of turning the feature off or on, and the last flag wins", () => {
    const off = "context preset disables image generation";
    expect(contextBlocks(["--disable=image_generation"], ["image"])).toBe(off);
    expect(contextBlocks(["-c", "features.image_generation=false"], ["image"])).toBe(off);
    expect(contextBlocks(["--config", "features.image_generation=false"], ["image"])).toBe(off);
    expect(contextBlocks(["--disable", "image_generation", "--enable", "image_generation"], ["image"])).toBeUndefined();
    expect(contextBlocks(["-c", "features.image_generation=false", "-c", "features.image_generation=true"], ["image"])).toBeUndefined();
    expect(contextBlocks(["--disable", "image_generation"], ["image"], "the agent's flags")).toBe("the agent's flags disables image generation");
  });

  it("does not block without the capability, for other features, or without args", () => {
    expect(contextBlocks(["--disable", "image_generation"], [])).toBeUndefined();
    expect(contextBlocks(["--disable", "hooks"], ["image"])).toBeUndefined();
    expect(contextBlocks(["image_generation"], ["image"])).toBeUndefined();
    expect(contextBlocks(undefined, ["image"])).toBeUndefined();
  });
});
