#!/usr/bin/env node
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { orchHome } from "../core/config.js";
import { billableTokens } from "../core/usage.js";
import { formatPlan, formatSelection } from "../core/plan-report.js";
import { connectOrStart, sendRequest } from "../daemon/client.js";

const sock = join(orchHome(), "sock");
const server = new McpServer({ name: "orch", version: "0.1.0" });

const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  ...(isError ? { isError: true } : {}),
});

server.tool(
  "orch_run",
  "Run a coding task via orch. Routes to Claude Code or Codex and fails over to the other on rate limit or failure. Optionally run it through roles (role, roles, team) or let orch pick roles from the prompt (auto); dryRun shows the plan without running anything.",
  {
    prompt: z.string().describe("The task for the agent."),
    cwd: z.string().optional().describe("Working directory for the task. Defaults to the server's directory."),
    context: z.string().optional().describe("Name of a context preset from the config (for example lean) that trims what the agent loads."),
    role: z.string().optional().describe("Run one role (for example reviewer) as a single call."),
    roles: z.array(z.string()).optional().describe("Run these roles in order, passing a handoff from each to the next."),
    team: z.string().optional().describe("Run a configured team of roles (quick, standard or full)."),
    dryRun: z.boolean().optional().describe("Show the plan (roles, agents, skips) without running anything."),
    requireCodex: z.boolean().optional().describe("Fail instead of skipping a role that needs Codex when Codex is not ready."),
    keepGoing: z.boolean().optional().describe("Keep running later roles after a role fails."),
    auto: z.boolean().optional().describe("Pick roles from the prompt with keyword rules; false turns auto off for this call."),
    sequential: z.boolean().optional().describe("Run one role at a time even when read-only roles could overlap."),
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
    const assets = [...(r.assets ?? []), ...(r.roles ?? []).flatMap((x) => x.assets ?? [])];
    const parts = [
      `status=${r.status}`,
      `agent=${r.agent ?? "-"}`,
      `failedOver=${r.failedOver}`,
      ...(r.usage ? [`tokens=${billableTokens(r.usage)}`] : []),
      ...(r.roles ? [`roles=${r.roles.map((x) => `${x.role}:${x.status}`).join(",")}`] : []),
      ...(r.selection
        ? [`auto=${r.selection.roles.join(",") || "none"}${r.selection.dropped.length ? ` dropped=${r.selection.dropped.join(",")}` : ""}`]
        : []),
      ...(r.message ? [`message=${r.message}`] : []),
    ];
    const footer = `\n\n[orch] ${parts.join(" ")}${assets.length ? `\n[orch] assets:\n${assets.map((a) => `  ${a}`).join("\n")}` : ""}`;
    return text(r.output + footer, r.status !== "ok");
  },
);

server.tool("orch_status", "Show agent cooldowns and recent jobs.", {}, async () => {
  await connectOrStart(sock);
  const m = await sendRequest(sock, { type: "status" }, () => {});
  return text(JSON.stringify(m, null, 2));
});

await server.connect(new StdioServerTransport());
