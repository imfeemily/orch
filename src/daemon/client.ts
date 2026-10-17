import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../core/config.js";
import type { Message, Request } from "./protocol.js";

export function isAlive(sockPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(sockPath);
    c.once("connect", () => {
      c.destroy();
      resolve(true);
    });
    c.once("error", () => resolve(false));
  });
}

export function sendRequest(
  sockPath: string,
  req: Request,
  onChunk: (m: Message) => void,
): Promise<Message> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sockPath);
    socket.setEncoding("utf8");
    let buf = "";
    let done = false;
    socket.on("connect", () => socket.write(`${JSON.stringify(req)}\n`));
    socket.on("data", (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as Message;
        if (msg.type === "chunk") {
          onChunk(msg);
        } else {
          done = true;
          socket.destroy();
          resolve(msg);
          return;
        }
      }
    });
    socket.on("error", (e) => {
      if (!done) reject(e);
    });
    socket.on("close", () => {
      if (!done) reject(new Error("daemon closed the connection before replying"));
    });
  });
}

export async function connectOrStart(sockPath: string, timeoutMs = 5000): Promise<void> {
  if (await isAlive(sockPath)) return;
  loadConfig(); // throws a readable error here instead of a silent daemon crash
  const entry = fileURLToPath(new URL("./index.js", import.meta.url));
  spawn(process.execPath, [entry], { detached: true, stdio: "ignore" }).unref();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isAlive(sockPath)) return;
  }
  throw new Error(`orch daemon did not start within ${timeoutMs}ms`);
}
