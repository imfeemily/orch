import type { AgentName, JobEntry, TaskResult } from "../core/types.js";

export type Request =
  | {
      type: "run";
      prompt: string;
      cwd: string;
      depth: number;
      context?: string;
      role?: string;
      roles?: string[];
      team?: string;
      dryRun?: boolean;
      requireCodex?: boolean;
      keepGoing?: boolean;
    }
  | { type: "status" }
  | { type: "shutdown" };

export type Message =
  | { type: "chunk"; text: string }
  | { type: "result"; result: TaskResult }
  | { type: "status"; cooldowns: Partial<Record<AgentName, number>>; jobs: JobEntry[] }
  | { type: "ok" }
  | { type: "error"; message: string };
