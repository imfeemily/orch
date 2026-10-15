#!/usr/bin/env node
import { join } from "node:path";
import { loadConfig, orchHome } from "../core/config.js";
import { runCommand } from "../core/runner.js";
import { StateStore } from "../core/state.js";
import { startDaemon } from "./server.js";

const home = orchHome();

const handle = await startDaemon({
  sockPath: join(home, "sock"),
  deps: {
    config: loadConfig(),
    state: new StateStore(join(home, "state.json")),
    run: runCommand,
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
