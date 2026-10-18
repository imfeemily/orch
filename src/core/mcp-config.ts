import { join } from "node:path";

export type McpClient = "vscode" | "cursor" | "claude-desktop";
export const MCP_CLIENTS: McpClient[] = ["vscode", "cursor", "claude-desktop"];

export interface ClientContext {
  home: string;
  cwd: string;
  platform: NodeJS.Platform;
  appData: string | undefined;
}

export interface ClientConfig {
  /** the file the client reads */
  path: string;
  /** the object in that file that maps server names to settings */
  key: "servers" | "mcpServers";
  entry: Record<string, unknown>;
}

/** Where each client keeps its MCP servers and what an orch entry looks like there. */
export function clientConfig(client: McpClient, ctx: ClientContext): ClientConfig {
  if (client === "vscode") {
    return { path: join(ctx.cwd, ".vscode", "mcp.json"), key: "servers", entry: { type: "stdio", command: "orch-mcp", args: [] } };
  }
  const entry = { command: "orch-mcp", args: [] };
  if (client === "cursor") return { path: join(ctx.home, ".cursor", "mcp.json"), key: "mcpServers", entry };
  const dir =
    ctx.platform === "darwin"
      ? join(ctx.home, "Library", "Application Support", "Claude")
      : ctx.platform === "win32"
        ? join(ctx.appData ?? join(ctx.home, "AppData", "Roaming"), "Claude")
        : join(ctx.home, ".config", "Claude");
  return { path: join(dir, "claude_desktop_config.json"), key: "mcpServers", entry };
}

export interface Merged {
  text: string;
  change: "added" | "updated" | "unchanged";
}

/**
 * Adds (or refreshes) the orch entry in a client's config file text, keeping everything else.
 * Throws instead of guessing when the file is not plain JSON, so nothing is ever overwritten.
 */
export function mergeClientConfig(existing: string | undefined, cfg: ClientConfig): Merged {
  let doc: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch {
      throw new Error(`${cfg.path} is not valid JSON (comments are not supported here); add the orch entry by hand`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${cfg.path} must contain a JSON object`);
    }
    doc = parsed as Record<string, unknown>;
  }
  const current = doc[cfg.key];
  if (current !== undefined && (typeof current !== "object" || current === null || Array.isArray(current))) {
    throw new Error(`"${cfg.key}" in ${cfg.path} must be an object`);
  }
  const servers = { ...((current as Record<string, unknown> | undefined) ?? {}) };
  const had = Object.hasOwn(servers, "orch");
  const same = had && JSON.stringify(servers.orch) === JSON.stringify(cfg.entry);
  servers.orch = cfg.entry;
  return {
    text: `${JSON.stringify({ ...doc, [cfg.key]: servers }, null, 2)}\n`,
    change: !had ? "added" : same ? "unchanged" : "updated",
  };
}
