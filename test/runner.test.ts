import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderArgs, runCommand } from "../src/core/runner.js";

const FAKE = fileURLToPath(new URL("./helpers/fake-agent.mjs", import.meta.url));
const node = process.execPath;
const base = { cwd: process.cwd(), depth: 0 };

describe("renderArgs", () => {
  it("replaces every {prompt} placeholder", () => {
    expect(renderArgs(["-p", "{prompt}", "--x={prompt}"], "hi")).toEqual(["-p", "hi", "--x=hi"]);
  });
});

describe("runCommand", () => {
  it("captures stdout and exit 0", async () => {
    const r = await runCommand(node, [FAKE, "ok", "{prompt}"], "hello", base);
    expect(r).toEqual({ exitCode: 0, stdout: "done: hello\n", stderr: "" });
  });

  it("captures a non-zero exit and stderr", async () => {
    const r = await runCommand(node, [FAKE, "fail"], "", base);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("boom");
  });

  it("passes a hostile prompt as exactly one argv element", async () => {
    const prompt = '--help "quoted" $(x) `y`\nline2';
    const r = await runCommand(node, [FAKE, "echo-args", "{prompt}"], prompt, base);
    expect(JSON.parse(r.stdout)).toEqual([prompt]);
  });

  it("reports a missing binary instead of throwing", async () => {
    const r = await runCommand("definitely-not-installed-xyz", [], "", base);
    expect(r.exitCode).toBeNull();
    expect(r.stderr).toContain("failed to start");
  });

  it("sets ORCH_DEPTH to depth + 1", async () => {
    const r = await runCommand(node, [FAKE, "depth"], "", { ...base, depth: 0 });
    expect(r.stdout.trim()).toBe("1");
  });

  it("kills the process on timeout", async () => {
    const r = await runCommand(node, [FAKE, "sleep"], "", { ...base, timeoutMs: 200 });
    expect(r.exitCode).toBeNull();
    expect(r.stderr).toContain("timed out");
  });

  it("streams stdout chunks to onChunk", async () => {
    const chunks: string[] = [];
    await runCommand(node, [FAKE, "ok", "x"], "", { ...base, onChunk: (t) => chunks.push(t) });
    expect(chunks.join("")).toBe("done: x\n");
  });
});
