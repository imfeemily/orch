import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentName } from "./types.js";

const exec = promisify(execFile);

/** Diffs up to this size are inlined; larger ones are summarised with `git diff --stat`. */
export const INLINE_DIFF_MAX_CHARS = 4_000;

export interface HandoffInput {
  prompt: string;
  cwd: string;
  previousAgent: AgentName;
  reason: "limited" | "auth" | "failed";
  summary?: string;
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 50 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

export async function buildHandoff(input: HandoffInput): Promise<string> {
  const { prompt, cwd, previousAgent, reason, summary } = input;
  const status = await git(cwd, ["status", "--short"]);
  const diff = (await git(cwd, ["diff", "HEAD"])) ?? (await git(cwd, ["diff"])) ?? "";

  const why =
    reason === "limited" ? "hit a usage/rate limit" : reason === "auth" ? "could not authenticate" : "failed";
  const parts: string[] = [
    `You are continuing a task started by another coding agent (${previousAgent}), which stopped because it ${why}.`,
    `## Original task\n${prompt}`,
  ];

  if (status === null) {
    parts.push(
      "## Working tree\nNot a git repository (or git unavailable); inspect the files directly.",
    );
  } else {
    parts.push(`## Working tree status\n${status.trim() === "" ? "(clean)" : status.trimEnd()}`);
    if (diff.trim() === "") {
      parts.push("## Diff so far\n(no changes)");
    } else if (diff.length <= INLINE_DIFF_MAX_CHARS) {
      parts.push(`## Diff so far\n${diff}`);
    } else {
      const stat = (await git(cwd, ["diff", "HEAD", "--stat"])) ?? (await git(cwd, ["diff", "--stat"])) ?? "";
      parts.push(
        `## Changes so far (diff too large to inline: ${diff.length} chars)\n${stat.trimEnd()}\n\nRun \`git diff\` to inspect the changes.`,
      );
    }
  }

  if (summary) parts.push(`## Summary from previous agent\n${summary}`);
  parts.push("Continue from the current state of the working tree. Do not redo completed work.");
  return parts.join("\n\n");
}
