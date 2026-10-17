import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgentOutput } from "../src/core/output.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseAgentOutput claude-json", () => {
  it("reads the answer, usage and cost from a real success", () => {
    const out = parseAgentOutput("claude-json", fixture("claude-success.json"));
    expect(out.text).toBe("pong");
    expect(out.errorText).toBeUndefined();
    expect(out.usage!.outputTokens).toBeGreaterThan(0);
    expect(out.usage!.costUsd).toBeGreaterThan(0);
  });

  it("reports the error text of a real failure (is_error with empty stderr)", () => {
    const out = parseAgentOutput("claude-json", fixture("claude-error.json"));
    expect(out.errorText).toContain("not-a-real-model");
  });

  it("maps usage: cache creation counts as input, cache reads are separate", () => {
    const stdout = JSON.stringify({
      result: "x",
      usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5, output_tokens: 7 },
    });
    expect(parseAgentOutput("claude-json", stdout).usage).toEqual({
      inputTokens: 110,
      cacheReadTokens: 5,
      outputTokens: 7,
    });
  });
});

describe("parseAgentOutput codex-jsonl", () => {
  it("reads the answer and usage from a real success", () => {
    const out = parseAgentOutput("codex-jsonl", fixture("codex-success.jsonl"));
    expect(out.text).toBe("pong");
    expect(out.errorText).toBeUndefined();
    expect(out.usage).toBeDefined();
  });

  it("maps usage: cached input is split out of input", () => {
    const stdout = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}',
      '{"type":"turn.completed","usage":{"input_tokens":21613,"cached_input_tokens":12544,"output_tokens":5,"reasoning_output_tokens":0}}',
    ].join("\n");
    expect(parseAgentOutput("codex-jsonl", stdout).usage).toMatchObject({
      inputTokens: 9069,
      cacheReadTokens: 12544,
      outputTokens: 5,
    });
  });

  it("reports the inner message of a real failure, not the raw JSON string", () => {
    const out = parseAgentOutput("codex-jsonl", fixture("codex-error.jsonl"));
    expect(out.errorText).toContain("not-a-real-model");
    expect(out.errorText).not.toContain('"type"');
  });

  it("does not treat a non-fatal error warning item as a failure", () => {
    const stdout = [
      '{"type":"item.completed","item":{"type":"error","message":"Model metadata not found"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
    ].join("\n");
    const out = parseAgentOutput("codex-jsonl", stdout);
    expect(out.errorText).toBeUndefined();
    expect(out.text).toBe("done");
  });
});

describe("parseAgentOutput fallback", () => {
  for (const kind of ["claude-json", "codex-jsonl"] as const) {
    it(`${kind}: plain text and truncated JSON fall back to the raw text`, () => {
      for (const raw of ["plain text answer", '{"result": "cut off']) {
        expect(parseAgentOutput(kind, raw)).toEqual({ text: raw });
      }
    });
  }

  it("text returns the input unchanged", () => {
    expect(parseAgentOutput("text", "hello\n")).toEqual({ text: "hello\n" });
  });
});
