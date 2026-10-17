import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentName, Outcome, Usage } from "./types.js";

/** Approximate quota unit: input without cache reads, plus output (reasoning is inside output). */
export function billableTokens(u: Usage): number {
  return u.inputTokens + u.outputTokens;
}

export interface LedgerEntry {
  at: number;
  taskId: string;
  agent: AgentName;
  model?: string;
  context?: string;
  role?: string;
  outcome: Outcome;
  usage?: Usage;
  durationMs: number;
  promptChars: number;
}

/** Append-only JSON Lines record of every agent attempt. It never throws: a ledger problem must not fail a task. */
export class Ledger {
  constructor(private readonly path: string) {}

  append(entry: LedgerEntry): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      /* ignore */
    }
  }

  private readAll(): LedgerEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return [];
    }
    const entries: LedgerEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e.at === "number") entries.push(e);
      } catch {
        /* skip a corrupt line */
      }
    }
    return entries;
  }

  readSince(sinceMs: number): LedgerEntry[] {
    return this.readAll().filter((e) => e.at >= sinceMs);
  }

  trim(keepMs: number, now: number = Date.now()): void {
    if (!existsSync(this.path)) return;
    try {
      const kept = this.readAll().filter((e) => e.at >= now - keepMs);
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, kept.map((e) => `${JSON.stringify(e)}\n`).join(""), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch {
      /* ignore */
    }
  }
}

export interface UsageRow {
  key: string;
  tasks: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  billableTokens: number;
  costUsd: number;
}

/** Adds token fields and cost; undefined when no entry has usage. */
export function sumUsage(usages: Array<Usage | undefined>): Usage | undefined {
  const present = usages.filter((u): u is Usage => u !== undefined);
  if (present.length === 0) return undefined;
  return present.reduce<Usage>(
    (a, u) => ({
      inputTokens: a.inputTokens + u.inputTokens,
      cacheReadTokens: a.cacheReadTokens + u.cacheReadTokens,
      outputTokens: a.outputTokens + u.outputTokens,
      ...(a.costUsd !== undefined || u.costUsd !== undefined ? { costUsd: (a.costUsd ?? 0) + (u.costUsd ?? 0) } : {}),
    }),
    { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  );
}

/**
 * Trims the ledger on an interval so a long-running daemon does not let it grow. Only the daemon
 * writes the file and `append` and `trim` are synchronous, so they never interleave.
 */
export function scheduleTrim(ledger: Ledger, keepMs: number, everyMs: number): NodeJS.Timeout {
  const timer = setInterval(() => ledger.trim(keepMs), everyMs);
  timer.unref();
  return timer;
}

export function summarize(entries: LedgerEntry[], by: "agent" | "model" | "context" | "role"): UsageRow[] {
  const rows = new Map<string, UsageRow>();
  const tasks = new Map<string, Set<string>>();
  for (const e of entries) {
    const key =
      by === "agent" ? e.agent : by === "model" ? (e.model ?? "(default)") : by === "context" ? (e.context ?? "(none)") : (e.role ?? "(none)");
    const row =
      rows.get(key) ??
      { key, tasks: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, billableTokens: 0, costUsd: 0 };
    const seen = tasks.get(key) ?? new Set<string>();
    seen.add(e.taskId);
    tasks.set(key, seen);
    row.tasks = seen.size;
    if (e.usage) {
      row.inputTokens += e.usage.inputTokens;
      row.cacheReadTokens += e.usage.cacheReadTokens;
      row.outputTokens += e.usage.outputTokens;
      row.billableTokens += billableTokens(e.usage);
      row.costUsd += e.usage.costUsd ?? 0;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.billableTokens - a.billableTokens);
}

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** "30m", "24h", "7d" to milliseconds; null for anything else. */
export function parseDuration(text: string): number | null {
  const m = /^(\d+)([mhd])$/.exec(text);
  if (!m || Number(m[1]) <= 0) return null;
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}
