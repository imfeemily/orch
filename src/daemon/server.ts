import { chmodSync, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import net from "node:net";
import { dirname, isAbsolute } from "node:path";
import { type Deps, runTask } from "../core/orchestrator.js";
import { isAlive } from "./client.js";
import type { Message, Request } from "./protocol.js";

export interface DaemonOptions {
  sockPath: string;
  deps: Deps;
  onShutdown?: () => void;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export async function startDaemon(opts: DaemonOptions): Promise<{ close(): Promise<void> }> {
  const { sockPath, deps, onShutdown } = opts;
  mkdirSync(dirname(sockPath), { recursive: true, mode: 0o700 });

  if (existsSync(sockPath)) {
    if (await isAlive(sockPath)) throw new Error(`orch daemon already running at ${sockPath}`);
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
      try {
        const result = await runTask(deps, {
          prompt: req.prompt,
          cwd: req.cwd,
          depth: Number(req.depth) || 0,
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

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => resolve());
  });
  chmodSync(sockPath, 0o600);

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          try {
            unlinkSync(sockPath);
          } catch {
            /* already gone */
          }
          resolve();
        });
      }),
  };
}
