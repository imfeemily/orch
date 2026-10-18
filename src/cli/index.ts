#!/usr/bin/env node
import { join, resolve } from "node:path";
import { initConfig, orchHome } from "../core/config.js";
import { connectOrStart, isAlive, sendRequest } from "../daemon/client.js";
import { parseArgs } from "./args.js";
import { Ledger, billableTokens, parseDuration, summarize } from "../core/usage.js";
import { finalOutputToPrint } from "./render.js";
import { loadConfig } from "../core/config.js";
import { pickOnlyRoute } from "../core/tiers.js";
import { selectRoles } from "../core/select-roles.js";
import { formatTier, formatAssets, formatPlan, formatRoles, formatSelection } from "../core/plan-report.js";
import { formatUsage } from "./usage-report.js";
import { USAGE } from "./usage.js";

async function main(): Promise<number> {
  const cmd = parseArgs(process.argv.slice(2));
  const sock = join(orchHome(), "sock");

  switch (cmd.name) {
    case "help":
      console.log(USAGE);
      return 0;

    case "usage": {
      const ledger = new Ledger(join(orchHome(), "usage.jsonl"));
      const entries = ledger.readSince(Date.now() - parseDuration(cmd.since)!);
      console.log(formatUsage(summarize(entries, cmd.by), cmd.since));
      return 0;
    }

    case "explain": {
      const cfg = loadConfig();
      console.log(cmd.only ? formatTier(pickOnlyRoute(cfg, cmd.only, cmd.prompt)) : formatSelection(selectRoles(cfg, cmd.prompt)));
      return 0;
    }

    case "init": {
      const path = join(orchHome(), "config.yaml");
      console.log(initConfig(path) === "created" ? `created ${path}` : `${path} already exists, left unchanged`);
      return 0;
    }

    case "daemon": {
      if (cmd.action === "start") {
        await connectOrStart(sock);
        console.log("orch daemon running");
        return 0;
      }
      if (!(await isAlive(sock))) {
        console.log("orch daemon not running");
        return 0;
      }
      await sendRequest(sock, { type: "shutdown" }, () => {});
      console.log("orch daemon stopped");
      return 0;
    }

    case "status": {
      await connectOrStart(sock);
      const m = await sendRequest(sock, { type: "status" }, () => {});
      if (m.type !== "status") throw new Error("unexpected reply from daemon");
      for (const agent of ["claude", "codex"] as const) {
        const until = m.cooldowns[agent] ?? 0;
        const left = Math.ceil((until - Date.now()) / 60000);
        console.log(`${agent}: ${left > 0 ? `cooling down, ${left}m left` : "available"}`);
      }
      const rows = summarize(new Ledger(join(orchHome(), "usage.jsonl")).readSince(Date.now() - 86_400_000), "agent");
      const tokens = (a: string) => (rows.find((r) => r.key === a)?.billableTokens ?? 0).toLocaleString("en-US");
      console.log(`tokens (24h): claude ${tokens("claude")}, codex ${tokens("codex")}`);
      for (const j of m.jobs.slice(-10)) {
        const when = new Date(j.at).toISOString();
        console.log(
          `${when} ${j.status} ${j.agent ?? "-"}${j.failedOver ? " (failover)" : ""}${j.model ? ` [${j.model}]` : ""}${j.context ? ` <${j.context}>` : ""}${j.role ? ` {${j.role}}` : ""} ${j.promptPreview}`,
        );
      }
      return 0;
    }

    case "run": {
      await connectOrStart(sock);
      const depth = Number(process.env.ORCH_DEPTH ?? 0) || 0;
      const final = await sendRequest(
        sock,
        {
          type: "run",
          prompt: cmd.prompt,
          cwd: resolve(cmd.cwd ?? process.cwd()),
          depth,
          context: cmd.context,
          role: cmd.role,
          roles: cmd.roles,
          team: cmd.team,
          dryRun: cmd.dryRun,
          requireCodex: cmd.requireCodex,
          keepGoing: cmd.keepGoing,
          auto: cmd.auto,
          sequential: cmd.sequential,
          only: cmd.only,
        },
        (m) => {
          if (m.type === "chunk") process.stdout.write(m.text);
          else if (m.type === "progress") process.stderr.write(`orch: ${m.text}\n`);
        },
      );
      if (final.type === "error") throw new Error(final.message);
      if (final.type !== "result") throw new Error("unexpected reply from daemon");
      const r = final.result;
      if (r.status === "planned") {
        if (r.selection) console.log(formatSelection(r.selection));
        console.log(formatPlan(r));
        return 0;
      }
      process.stdout.write(finalOutputToPrint(r.streamed === true, r.output));
      if (r.selection) console.error(formatSelection(r.selection));
      const roleReport = formatRoles(r);
      if (roleReport) console.error(roleReport);
      const assetReport = formatAssets(r);
      if (assetReport) console.error(assetReport);
      if (r.failedOver) console.error(`\norch: switched agent, finished with ${r.agent}`);
      if (r.status !== "ok") {
        console.error(`orch: ${r.status}${r.message ? `: ${r.message}` : ""}`);
        return 1;
      }
      return 0;
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`orch: ${err.message}`);
    process.exit(1);
  },
);
