import { parseDuration } from "../core/usage.js";

export type Command =
  | {
      name: "run";
      prompt: string;
      cwd?: string;
      context?: string;
      role?: string;
      roles?: string[];
      team?: string;
      dryRun?: boolean;
      requireCodex?: boolean;
      keepGoing?: boolean;
    }
  | { name: "status" }
  | { name: "init" }
  | { name: "usage"; since: string; by: "agent" | "model" | "context" | "role" }
  | { name: "daemon"; action: "start" | "stop" }
  | { name: "help" };

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  if (cmd === "run") {
    let cwd: string | undefined;
    let context: string | undefined;
    let role: string | undefined;
    let roles: string[] | undefined;
    let team: string | undefined;
    let dryRun = false;
    let requireCodex = false;
    let keepGoing = false;
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
      if (rest[i] === "--role") {
        role = rest[++i];
        if (!role) throw new Error("--role requires a role name");
        continue;
      }
      if (rest[i] === "--roles") {
        roles = (rest[++i] ?? "").split(",").map((r) => r.trim()).filter(Boolean);
        if (roles.length === 0) throw new Error("--roles requires a comma-separated list of role names");
        continue;
      }
      if (rest[i] === "--team") {
        team = rest[++i];
        if (!team) throw new Error("--team requires a team name");
        continue;
      }
      if (rest[i] === "--dry-run") { dryRun = true; continue; }
      if (rest[i] === "--require-codex") { requireCodex = true; continue; }
      if (rest[i] === "--keep-going") { keepGoing = true; continue; }
      words.push(rest[i]);
    }
    const prompt = words.join(" ").trim();
    if (!prompt) throw new Error("usage: orch run [--cwd DIR] <prompt>");
    const chosen = [role !== undefined && "--role", roles !== undefined && "--roles", team !== undefined && "--team"].filter(Boolean);
    if (chosen.length > 1) throw new Error(`choose only one of ${chosen.join(" and ")}`);
    return {
      name: "run", prompt, cwd, context, role, roles, team,
      ...(dryRun ? { dryRun } : {}), ...(requireCodex ? { requireCodex } : {}), ...(keepGoing ? { keepGoing } : {}),
    };
  }
  if (cmd === "usage") {
    let since = "24h";
    let by: "agent" | "model" | "context" | "role" = "agent";
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--since") {
        since = rest[++i] ?? "";
        if (parseDuration(since) === null) {
          throw new Error("invalid --since: expected a number and unit like 30m, 24h or 7d");
        }
      } else if (rest[i] === "--by") {
        const v = rest[++i];
        if (v !== "agent" && v !== "model" && v !== "context" && v !== "role") throw new Error("--by must be agent, model, context or role");
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
