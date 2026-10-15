import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentName } from "./types.js";

const exec = promisify(execFile);

export const MAX_DIFF_CHARS = 20_000;

export interface HandoffInput {
  prompt: string;
  cwd: string;
  previousAgent: AgentName;
  reason: "limited" | "failed";
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

function truncate(text: string): string {
  if (text.length <= MAX_DIFF_CHARS) return text;
  const dropped = text.length - MAX_DIFF_CHARS;
  return `${text.slice(0, MAX_DIFF_CHARS)}\n... [diff truncated, ${dropped} more chars]`;
}

export async function buildHandoff(input: HandoffInput): Promise<string> {
  const { prompt, cwd, previousAgent, reason, summary } = input;
  const status = await git(cwd, ["status", "--short"]);
  const diff = (await git(cwd, ["diff", "HEAD"])) ?? (await git(cwd, ["diff"])) ?? "";

  const why = reason === "limited" ? "hit a usage/rate limit" : "failed";
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
    parts.push(`## Diff so far\n${diff.trim() === "" ? "(no changes)" : truncate(diff)}`);
  }

  if (summary) parts.push(`## Summary from previous agent\n${summary}`);
  parts.push("Continue from the current state of the working tree. Do not redo completed work.");
  return parts.join("\n\n");
}
