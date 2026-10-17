#!/usr/bin/env node
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { orchHome } from "../core/config.js";
import { billableTokens } from "../core/usage.js";
import { formatPlan, formatSelection } from "../cli/plan-report.js";
import { connectOrStart, sendRequest } from "../daemon/client.js";

const sock = join(orchHome(), "sock");
const server = new McpServer({ name: "orch", version: "0.1.0" });

const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  ...(isError ? { isError: true } : {}),
});

server.tool(
  "orch_run",
  "Run a coding task via orch. Routes to Claude Code or Codex and fails over to the other on rate limit or failure.",
  {
    prompt: z.string(),
    cwd: z.string().optional(),
    context: z.string().optional(),
    role: z.string().optional(),
    roles: z.array(z.string()).optional(),
    team: z.string().optional(),
    dryRun: z.boolean().optional(),
    requireCodex: z.boolean().optional(),
    keepGoing: z.boolean().optional(),
    auto: z.boolean().optional(),
    sequential: z.boolean().optional(),
  },
  async ({ prompt, cwd, context, role, roles, team, dryRun, requireCodex, keepGoing, auto, sequential }) => {
    await connectOrStart(sock);
    const depth = Number(process.env.ORCH_DEPTH ?? 0) || 0;
    const final = await sendRequest(
      sock,
      { type: "run", prompt, cwd: resolve(cwd ?? process.cwd()), depth, context, role, roles, team, dryRun, requireCodex, keepGoing, auto, sequential },
      () => {},
    );
    if (final.type === "error") return text(final.message, true);
    if (final.type !== "result") return text("unexpected reply from daemon", true);
    const r = final.result;
    if (r.status === "planned") return text(`${r.selection ? `${formatSelection(r.selection)}\n` : ""}${formatPlan(r)}`);
    const footer = `\n\n[orch] status=${r.status} agent=${r.agent ?? "-"} failedOver=${r.failedOver}${r.usage ? ` tokens=${billableTokens(r.usage)}` : ""}${
      r.roles ? ` roles=${r.roles.map((x) => `${x.role}:${x.status}`).join(",")}` : ""
    }${r.selection ? ` auto=${r.selection.roles.join(",") || "none"}${r.selection.dropped.length ? ` dropped=${r.selection.dropped.join(",")}` : ""}` : ""}${
      [...(r.assets ?? []), ...(r.roles ?? []).flatMap((x) => x.assets ?? [])].length ? ` assets=${[...(r.assets ?? []), ...(r.roles ?? []).flatMap((x) => x.assets ?? [])].join(",")}` : ""
    }${
      r.message ? ` message=${r.message}` : ""
    }`;
    return text(r.output + footer, r.status !== "ok");
  },
);

server.tool("orch_status", "Show agent cooldowns and recent jobs.", {}, async () => {
  await connectOrStart(sock);
  const m = await sendRequest(sock, { type: "status" }, () => {});
  return text(JSON.stringify(m, null, 2));
});

await server.connect(new StdioServerTransport());
