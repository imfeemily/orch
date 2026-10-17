import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTask } from "../src/core/orchestrator.js";
import { StateStore } from "../src/core/state.js";
import type { Config, RunFn, RunResult } from "../src/core/types.js";
import { Ledger } from "../src/core/usage.js";
import { noSummaryConfig, withSummaryConfig } from "./helpers/config.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const claudeJson = (result: string, isError: boolean) =>
  JSON.stringify({ is_error: isError, result, usage: { input_tokens: 5, output_tokens: 7 } });
const exit1 = (stdout: string, stderr = ""): RunResult => ({ exitCode: 1, stdout, stderr });
const OK_CODEX: RunResult = {
  exitCode: 0,
  stderr: "",
  stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"from codex"}}\n',
};

interface Call { command: string; args: string[]; prompt: string }

function setup(results: Record<string, RunResult | RunResult[]>, config: Config = noSummaryConfig()) {
  const calls: Call[] = [];
  const run: RunFn = async (command, args, prompt) => {
    calls.push({ command, args, prompt });
    const r = results[args[0] === "--summary" ? `${command}:summary` : command];
    return Array.isArray(r) ? r.shift()! : r;
  };
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const ledger = new Ledger(join(dir, "usage.jsonl"));
  const state = new StateStore(join(dir, "state.json"));
  const deps = { config, state, run, ledger, now: () => 1_000_000 };
  return { calls, ledger, state, deps, cwd: dir, dir };
}
const go = (s: ReturnType<typeof setup>, prompt = "build a page", onChunk?: (t: string) => void) =>
  runTask(s.deps, { prompt, cwd: s.cwd, depth: 0, onChunk });

describe("parsed output", () => {
  it("returns the clean answer and usage, and records one ledger entry", async () => {
    const s = setup({ claude: { exitCode: 0, stdout: fixture("claude-success.json"), stderr: "" } });
    const r = await go(s);
    expect(r).toMatchObject({ status: "ok", agent: "claude", output: "pong" });
    expect(r.usage!.outputTokens).toBeGreaterThan(0);
    const [e] = s.ledger.readSince(0);
    expect(e).toMatchObject({ agent: "claude", outcome: "ok", promptChars: "build a page".length });
    expect(e.taskId).toHaveLength(8);
    expect(e.usage).toBeDefined();
  });

  it("falls back to the raw text when a JSON agent prints plain text", async () => {
    const s = setup({ claude: { exitCode: 0, stdout: "plain answer", stderr: "" } });
    const r = await go(s);
    expect(r.output).toBe("plain answer");
    expect(r.usage).toBeUndefined();
  });
});

describe("classification uses the parsed error text", () => {
  it("claude is_error JSON with empty stderr: auth, limited, and a plain failure", async () => {
    const auth = setup({ claude: exit1(claudeJson("Failed to authenticate: OAuth session expired", true)), codex: OK_CODEX });
    expect((await go(auth)).attempts[0].outcome).toBe("auth");

    const limited = setup({ claude: exit1(claudeJson("You've hit your usage limit.", true)), codex: OK_CODEX });
    const r = await go(limited);
    expect(r.attempts[0].outcome).toBe("limited");
    expect(limited.state.isCooling("claude", 1_000_000)).toBe(true);

    const failed = setup({ claude: exit1(fixture("claude-error.json")), codex: OK_CODEX });
    expect((await go(failed)).attempts[0].outcome).toBe("failed");
  });

  it("codex error events with a usage-limit message are limited", async () => {
    const ev = '{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Try again later."}}\n';
    const s = setup({ codex: exit1(ev), claude: { exitCode: 0, stdout: "ok", stderr: "" } });
    const r = await go(s, "fix typo in README");
    expect(r.attempts[0]).toMatchObject({ agent: "codex", outcome: "limited" });
  });

  it("a long failed answer that mentions rate limits early is not a limit", async () => {
    const text = `rate limit middleware added\n${Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n")}`;
    const s = setup({ claude: exit1(claudeJson(text, false)), codex: OK_CODEX });
    expect((await go(s)).attempts[0].outcome).toBe("failed");
  });

  it("the failure message shows the parsed error, not empty stderr", async () => {
    const s = setup({ claude: exit1(claudeJson("model exploded", true)), codex: exit1('{"type":"turn.failed","error":{"message":"also exploded"}}\n') });
    const r = await go(s);
    expect(r.status).toBe("failed");
    expect(r.message).toContain("also exploded");
  });
});

describe("chunks and ledger", () => {
  it("forwards chunks only for text agents", async () => {
    const seen: string[] = [];
    const cfg = noSummaryConfig();
    const run: RunFn = async (_c, _a, _p, opts) => {
      opts.onChunk?.("x");
      return { exitCode: 0, stdout: "x", stderr: "" };
    };
    const base = setup({}, cfg);
    await runTask({ ...base.deps, run }, { prompt: "p", cwd: base.cwd, depth: 0, onChunk: (t) => seen.push(t) });
    expect(seen).toEqual([]);

    cfg.agents.claude.output = "text";
    await runTask({ ...base.deps, run }, { prompt: "p", cwd: base.cwd, depth: 0, onChunk: (t) => seen.push(t) });
    expect(seen).toEqual(["x"]);
  });

  it("records one entry per attempt with a shared taskId on failover", async () => {
    const s = setup({ claude: exit1(claudeJson("You've hit your usage limit.", true)), codex: OK_CODEX });
    await go(s);
    const entries = s.ledger.readSince(0);
    expect(entries.map((e) => e.agent)).toEqual(["claude", "codex"]);
    expect(entries[0].taskId).toBe(entries[1].taskId);
  });

  it("works without a ledger and with an unwritable one", async () => {
    const s = setup({ claude: { exitCode: 0, stdout: "ok", stderr: "" } });
    const noLedger = await runTask({ ...s.deps, ledger: undefined }, { prompt: "p", cwd: s.cwd, depth: 0 });
    expect(noLedger.status).toBe("ok");

    const file = join(s.dir, "file");
    writeFileSync(file, "x");
    const bad = new Ledger(join(file, "sub", "usage.jsonl"));
    const r = await runTask({ ...s.deps, ledger: bad }, { prompt: "p", cwd: s.cwd, depth: 0 });
    expect(r.status).toBe("ok");
  });

  it("parses the summary call output before handing over", async () => {
    const s = setup(
      {
        claude: exit1("", "boom"),
        "claude:summary": { exitCode: 0, stdout: fixture("claude-success.json"), stderr: "" },
        codex: OK_CODEX,
      },
      withSummaryConfig(),
    );
    await go(s);
    const handoff = s.calls[s.calls.length - 1];
    expect(handoff.command).toBe("codex");
    expect(handoff.prompt).toContain("Summary from previous agent\npong");
  });
});
