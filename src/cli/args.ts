import { parseDuration } from "../core/usage.js";

export type Command =
  | { name: "run"; prompt: string; cwd?: string; context?: string }
  | { name: "status" }
  | { name: "init" }
  | { name: "usage"; since: string; by: "agent" | "model" | "context" }
  | { name: "daemon"; action: "start" | "stop" }
  | { name: "help" };

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  if (cmd === "run") {
    let cwd: string | undefined;
    let context: string | undefined;
    const words: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--cwd") {
        cwd = rest[++i];
        if (!cwd) throw new Error("--cwd requires a directory");
        continue;
      }
      if (rest[i] === "--context") {
        context = rest[++i];
        if (!context) throw new Error("--context requires a preset name");
        continue;
      }
      words.push(rest[i]);
    }
    const prompt = words.join(" ").trim();
    if (!prompt) throw new Error("usage: orch run [--cwd DIR] <prompt>");
    return { name: "run", prompt, cwd, context };
  }
  if (cmd === "usage") {
    let since = "24h";
    let by: "agent" | "model" | "context" = "agent";
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--since") {
        since = rest[++i] ?? "";
        if (parseDuration(since) === null) {
          throw new Error("invalid --since: expected a number and unit like 30m, 24h or 7d");
        }
      } else if (rest[i] === "--by") {
        const v = rest[++i];
        if (v !== "agent" && v !== "model" && v !== "context") throw new Error("--by must be agent, model or context");
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
