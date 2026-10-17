import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentName, JobEntry } from "./types.js";

interface StateFile {
  cooldowns: Partial<Record<AgentName, number>>;
  jobs: JobEntry[];
}

const MAX_JOBS = 50;

export class StateStore {
  constructor(private readonly path: string) {}

  private read(): StateFile {
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8"));
      return {
        cooldowns: data.cooldowns ?? {},
        jobs: Array.isArray(data.jobs) ? data.jobs : [],
      };
    } catch {
      return { cooldowns: {}, jobs: [] };
    }
  }

  private write(state: StateFile): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  cooldownUntil(agent: AgentName): number {
    return this.read().cooldowns[agent] ?? 0;
  }

  isCooling(agent: AgentName, now: number = Date.now()): boolean {
    return this.cooldownUntil(agent) > now;
  }

  setCooldown(agent: AgentName, untilMs: number): void {
    const s = this.read();
    s.cooldowns[agent] = untilMs;
    this.write(s);
  }

  appendJob(entry: JobEntry): void {
    const s = this.read();
    s.jobs.push(entry);
    s.jobs = s.jobs.slice(-MAX_JOBS);
    this.write(s);
  }

  snapshot(): StateFile {
    return this.read();
  }
}
