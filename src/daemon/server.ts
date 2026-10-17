import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import net from "node:net";
import { dirname, isAbsolute } from "node:path";
import { type Deps, runTask } from "../core/orchestrator.js";
import { type ReadinessChecker, createReadinessChecker } from "../core/readiness.js";
import { runAuto, runRoles } from "../core/team.js";
import { isAlive } from "./client.js";
import type { Message, Request } from "./protocol.js";

export interface DaemonOptions {
  sockPath: string;
  deps: Deps & { readiness?: ReadinessChecker };
  onShutdown?: () => void;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Identifies a socket file: an inode number alone can be reused right after an unlink, so add its change time. */
function socketId(path: string): string {
  const s = statSync(path, { bigint: true });
  return `${s.ino}:${s.ctimeNs}`;
}

/**
 * Only one daemon may start at a time: take an exclusive lock file for the duration of the start.
 * A lock left by a dead process is removed.
 */
function acquireStartLock(lockPath: string): () => void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let alive = false;
      try {
        const pid = Number(readFileSync(lockPath, "utf8"));
        if (pid > 0) {
          process.kill(pid, 0);
          alive = true;
        }
      } catch {
        alive = false;
      }
      if (alive) throw new Error(`orch daemon already starting at ${lockPath.replace(/\.lock$/, "")}`);
      try {
        unlinkSync(lockPath); // stale lock from a process that died
      } catch {
        /* lost a race to another starter; the next attempt will say so */
      }
    }
  }
  throw new Error(`could not take the start lock ${lockPath}`);
}

export async function startDaemon(opts: DaemonOptions): Promise<{ close(): Promise<void> }> {
  const { sockPath, deps, onShutdown } = opts;
  mkdirSync(dirname(sockPath), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(sockPath), 0o700); // a directory made earlier may be group- or world-readable
  } catch {
    /* not ours to change */
  }
  const release = acquireStartLock(`${sockPath}.lock`);

  if (existsSync(sockPath)) {
    if (await isAlive(sockPath)) {
      release();
      throw new Error(`orch daemon already running at ${sockPath}`);
    }
    unlinkSync(sockPath); // stale socket from a crashed daemon
  }

  const handle = async (socket: net.Socket, line: string, signal: AbortSignal) => {
    const send = (m: Message) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(m)}\n`);
    };
    let req: Request;
    try {
      req = JSON.parse(line);
    } catch {
      send({ type: "error", message: "invalid JSON" });
      return;
    }
    if (req.type === "status") {
      const s = deps.state.snapshot();
      send({ type: "status", cooldowns: s.cooldowns, jobs: s.jobs });
    } else if (req.type === "shutdown") {
      send({ type: "ok" });
      setImmediate(() => onShutdown?.());
    } else if (req.type === "run") {
      if (typeof req.prompt !== "string" || typeof req.cwd !== "string") {
        send({ type: "error", message: "run requires string prompt and cwd" });
        return;
      }
      if (!isAbsolute(req.cwd) || !isDirectory(req.cwd)) {
        send({ type: "error", message: `cwd must be an existing absolute directory: ${req.cwd}` });
        return;
      }
      const hasSelector = req.role !== undefined || req.roles !== undefined || req.team !== undefined;
      const autoOn = req.auto === true || (req.auto !== false && deps.config.auto.enabled && !hasSelector);
      const wantsRoles = hasSelector || req.dryRun === true || req.requireCodex === true || req.keepGoing === true || req.sequential === true;
      try {
        if (autoOn || wantsRoles) {
          const readiness =
            deps.readiness ??
            createReadinessChecker({ config: deps.config, isCooling: (a) => deps.state.isCooling(a, (deps.now ?? Date.now)()) });
          const result = await (autoOn ? runAuto : runRoles)(
            { ...deps, readiness },
            {
              task: req.prompt,
              cwd: req.cwd,
              depth: Number(req.depth) || 0,
              context: typeof req.context === "string" ? req.context : undefined,
              role: typeof req.role === "string" ? req.role : undefined,
              roles: Array.isArray(req.roles) ? req.roles.map(String) : undefined,
              team: typeof req.team === "string" ? req.team : undefined,
              dryRun: req.dryRun === true,
              requireCodex: req.requireCodex === true,
              keepGoing: req.keepGoing === true,
              auto: req.auto === true,
              sequential: req.sequential === true,
              signal,
              onChunk: (text) => send({ type: "chunk", text }),
              onProgress: (text) => send({ type: "progress", text }),
            },
          );
          send({ type: "result", result });
          return;
        }
        const result = await runTask(deps, {
          prompt: req.prompt,
          cwd: req.cwd,
          depth: Number(req.depth) || 0,
          context: typeof req.context === "string" ? req.context : undefined,
          signal,
          onChunk: (text) => send({ type: "chunk", text }),
        });
        send({ type: "result", result });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
    } else {
      send({ type: "error", message: "unknown request type" });
    }
  };

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    const ac = new AbortController();
    socket.on("close", () => ac.abort());
    let buf = "";
    socket.on("data", (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) void handle(socket, line, ac.signal);
      }
    });
    socket.on("error", () => {});
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(sockPath, () => resolve());
    });
  } catch (e) {
    release();
    throw e;
  }
  chmodSync(sockPath, 0o600);
  const ours = socketId(sockPath);
  release();

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          try {
            // only remove the socket if it is still ours: a newer daemon may have replaced it
            if (socketId(sockPath) === ours) unlinkSync(sockPath);
          } catch {
            /* already gone */
          }
          resolve();
        });
      }),
  };
}
