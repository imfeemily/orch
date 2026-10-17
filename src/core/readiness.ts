import { spawn } from "node:child_process";
import type { AgentName, Capability, Config } from "./types.js";

export type CommandRunner = (command: string, args: string[]) => Promise<{ exitCode: number | null; stdout: string }>;

export interface Readiness {
  ready: boolean;
  reasons: string[];
}

export type ReadinessChecker = (agent: AgentName, needs?: Capability[]) => Promise<Readiness>;

/** Runs a short command with a 10 second limit; never throws. */
export const spawnRunner: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    let stdout = "";
    let done = false;
    const finish = (exitCode: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout });
    };
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, 10_000);
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });

const LOGIN_HINT: Record<AgentName, string> = {
  claude: "not logged in: run `claude`, then /login",
  codex: "not logged in: run `codex login`",
};

export function createReadinessChecker(opts: {
  config: Config;
  isCooling: (a: AgentName) => boolean;
  run?: CommandRunner;
  ttlMs?: number;
  now?: () => number;
}): ReadinessChecker {
  const run = opts.run ?? spawnRunner;
  const ttl = opts.ttlMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; reasons: string[] }>();

  async function staticReasons(agent: AgentName, needs: Capability[]): Promise<string[]> {
    const command = opts.config.agents[agent].command;
    if ((await run(command, ["--version"])).exitCode !== 0) return ["not installed"];

    const reasons: string[] = [];
    if (agent === "claude") {
      const r = await run(command, ["auth", "status"]);
      let loggedIn = false;
      try {
        loggedIn = JSON.parse(r.stdout).loggedIn === true;
      } catch {
        /* unparsable: treat as not logged in */
      }
      if (!loggedIn) reasons.push(LOGIN_HINT.claude);
    } else if ((await run(command, ["login", "status"])).exitCode !== 0) {
      reasons.push(LOGIN_HINT.codex);
    }

    if (needs.includes("image")) {
      if (agent === "claude") {
        reasons.push("claude cannot generate images");
      } else {
        const f = await run(command, ["features", "list"]);
        if (!/^image_generation\s+\S+\s+true\s*$/m.test(f.stdout)) {
          reasons.push("image generation is disabled in codex features");
        }
      }
    }
    return reasons;
  }

  return async (agent, needs = []) => {
    const key = `${agent}|${[...needs].sort().join(",")}`;
    let entry = cache.get(key);
    if (!entry || now() - entry.at >= ttl) {
      entry = { at: now(), reasons: await staticReasons(agent, needs) };
      cache.set(key, entry);
    }
    const reasons = [...(opts.isCooling(agent) ? ["cooling down"] : []), ...entry.reasons];
    return { ready: reasons.length === 0, reasons };
  };
}
