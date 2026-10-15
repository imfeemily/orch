import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { StateStore } from "../src/core/state.js";
import { startDaemon } from "../src/daemon/server.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe("mcp server", () => {
  it("exposes orch_run and routes through the daemon", async () => {
    const home = mkdtempSync(join(tmpdir(), "orch-"));
    const daemon = await startDaemon({
      sockPath: join(home, "sock"),
      deps: {
        config: DEFAULT_CONFIG,
        state: new StateStore(join(home, "state.json")),
        run: async () => ({ exitCode: 0, stdout: "mcp-ok", stderr: "" }),
      },
    });
    closers.push(daemon.close);

    const entry = fileURLToPath(new URL("../src/mcp/index.ts", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", entry],
      env: { ...process.env, ORCH_HOME: home } as Record<string, string>,
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    closers.push(() => client.close());

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["orch_run", "orch_status"]);

    const res = (await client.callTool({
      name: "orch_run",
      arguments: { prompt: "hello", cwd: home },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("mcp-ok");
    expect(res.content[0].text).toContain("status=ok");
  }, 20_000);
});
