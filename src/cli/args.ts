import { parseDuration } from "../core/usage.js";

export type Command =
  | { name: "run"; prompt: string; cwd?: string }
  | { name: "status" }
  | { name: "init" }
  | { name: "usage"; since: string; by: "agent" | "model" }
  | { name: "daemon"; action: "start" | "stop" }
  | { name: "help" };

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  if (cmd === "run") {
    let cwd: string | undefined;
    const words: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--cwd") {
        cwd = rest[++i];
        if (!cwd) throw new Error("--cwd requires a directory");
        continue;
      }
      words.push(rest[i]);
    }
    const prompt = words.join(" ").trim();
    if (!prompt) throw new Error("usage: orch run [--cwd DIR] <prompt>");
    return { name: "run", prompt, cwd };
  }
  if (cmd === "usage") {
    let since = "24h";
    let by: "agent" | "model" = "agent";
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--since") {
        since = rest[++i] ?? "";
        if (parseDuration(since) === null) {
          throw new Error("invalid --since: expected a number and unit like 30m, 24h or 7d");
        }
      } else if (rest[i] === "--by") {
        const v = rest[++i];
        if (v !== "agent" && v !== "model") throw new Error("--by must be agent or model");
        by = v;
      } else {
        throw new Error(`unknown option: ${rest[i]}`);
      }
    }
    return { name: "usage", since, by };
  }
  if (cmd === "status") return { name: "status" };
  if (cmd === "init") return { name: "init" };
  if (cmd === "daemon" && (rest[0] === "start" || rest[0] === "stop")) {
    return { name: "daemon", action: rest[0] };
  }
  if (!cmd || cmd === "help" || cmd === "--help") return { name: "help" };
  throw new Error(`unknown command: ${cmd}`);
}
