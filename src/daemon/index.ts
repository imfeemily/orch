#!/usr/bin/env node
import { join } from "node:path";
import { loadConfig, orchHome } from "../core/config.js";
import { runCommand } from "../core/runner.js";
import { createReadinessChecker } from "../core/readiness.js";
import { StateStore } from "../core/state.js";
import { Ledger, scheduleTrim } from "../core/usage.js";
import { startDaemon } from "./server.js";

const home = orchHome();
const ledger = new Ledger(join(home, "usage.jsonl"));
ledger.trim(90 * 86_400_000); // keep the last 90 days
scheduleTrim(ledger, 90 * 86_400_000, 24 * 3_600_000); // and keep trimming while the daemon runs

const config = loadConfig();
const state = new StateStore(join(home, "state.json"));
const handle = await startDaemon({
  sockPath: join(home, "sock"),
  deps: {
    config,
    state,
    readiness: createReadinessChecker({ config, isCooling: (a) => state.isCooling(a) }),
    run: runCommand,
    ledger,
  },
  onShutdown: () => {
    void handle.close().then(() => process.exit(0));
  },
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void handle.close().then(() => process.exit(0));
  });
}
