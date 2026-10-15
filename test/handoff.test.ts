import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INLINE_DIFF_MAX_CHARS, buildHandoff } from "../src/core/handoff.js";

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "orch-git-"));
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir });
  git("init", "-q");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-qm", "init");
  return dir;
}

describe("buildHandoff", () => {
  it("includes the original prompt, status and diff", async () => {
    const dir = gitRepo();
    writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
    const out = await buildHandoff({
      prompt: "add two to a.txt",
      cwd: dir,
      previousAgent: "claude",
      reason: "limited",
    });
    expect(out).toContain("add two to a.txt");
    expect(out).toContain("claude");
    expect(out).toContain("M a.txt");
    expect(out).toContain("+two");
  });

  it("works outside a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-nogit-"));
    const out = await buildHandoff({ prompt: "p", cwd: dir, previousAgent: "codex", reason: "failed" });
    expect(out).toContain("Not a git repository");
    expect(out).toContain("p");
  });

  it("lists changed files instead of inlining a large diff", async () => {
    const dir = gitRepo();
    writeFileSync(join(dir, "a.txt"), "x".repeat(INLINE_DIFF_MAX_CHARS * 3) + "\n");
    const out = await buildHandoff({ prompt: "p", cwd: dir, previousAgent: "claude", reason: "limited" });
    expect(out).toContain("diff too large to inline");
    expect(out).toContain("a.txt |");
    expect(out).not.toContain("x".repeat(500));
    expect(out.length).toBeLessThan(INLINE_DIFF_MAX_CHARS);
  });

  it("explains an auth failure in the handoff", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-nogit-"));
    const out = await buildHandoff({ prompt: "p", cwd: dir, previousAgent: "claude", reason: "auth" });
    expect(out).toContain("could not authenticate");
  });

  it("includes a summary when provided", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-nogit-"));
    const out = await buildHandoff({
      prompt: "p",
      cwd: dir,
      previousAgent: "claude",
      reason: "limited",
      summary: "finished steps 1-2",
    });
    expect(out).toContain("Summary from previous agent");
    expect(out).toContain("finished steps 1-2");
  });
});
