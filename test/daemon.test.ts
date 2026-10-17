import { mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { StateStore } from "../src/core/state.js";
import type { RunFn } from "../src/core/types.js";
import { connectOrStart, isAlive, sendRequest } from "../src/daemon/client.js";
import { startDaemon } from "../src/daemon/server.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

function setup(run: RunFn) {
  // keep the path short: unix socket paths are limited to ~104 chars on macOS
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const sockPath = join(dir, "sock");
  const config = { ...DEFAULT_CONFIG, agents: { ...DEFAULT_CONFIG.agents, claude: { ...DEFAULT_CONFIG.agents.claude, output: "text" as const } } };
  const deps = { config, state: new StateStore(join(dir, "state.json")), run };
  return { dir, sockPath, deps };
}

const okRun: RunFn = async (_c, _a, _p, opts) => {
  opts.onChunk?.("part1 ");
  return { exitCode: 0, stdout: "part1 part2", stderr: "" };
};

describe("daemon", () => {
  it("runs a task and streams chunks", async () => {
    const s = setup(okRun);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    const chunks: string[] = [];
    const final = await sendRequest(
      s.sockPath,
      { type: "run", prompt: "hello", cwd: s.dir, depth: 0 },
      (m) => m.type === "chunk" && chunks.push(m.text),
    );
    expect(chunks).toEqual(["part1 "]);
    expect(final.type).toBe("result");
    if (final.type === "result") expect(final.result.status).toBe("ok");
  });

  it("answers status", async () => {
    const s = setup(okRun);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    const final = await sendRequest(s.sockPath, { type: "status" }, () => {});
    expect(final.type).toBe("status");
  });

  it("replaces a stale socket file", async () => {
    const s = setup(okRun);
    writeFileSync(s.sockPath, ""); // leftover from a crashed daemon
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    expect(await isAlive(s.sockPath)).toBe(true);
  });

  it("refuses to start over a live daemon", async () => {
    const s = setup(okRun);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    await expect(startDaemon({ sockPath: s.sockPath, deps: s.deps })).rejects.toThrow(/already running/);
    expect(await isAlive(s.sockPath)).toBe(true);
  });

  it("aborts the running agent when the client disconnects", async () => {
    let signalAborted!: () => void;
    const abortedP = new Promise<string>((r) => (signalAborted = () => r("aborted")));
    const run: RunFn = (_c, _a, _p, opts) =>
      new Promise((resolve) => {
        opts.signal?.addEventListener("abort", () => {
          signalAborted();
          resolve({ exitCode: null, stdout: "", stderr: "orch: aborted" });
        });
      });
    const s = setup(run);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    const c = net.connect(s.sockPath, () =>
      c.write(`${JSON.stringify({ type: "run", prompt: "x", cwd: s.dir, depth: 0 })}\n`),
    );
    await new Promise((r) => setTimeout(r, 200));
    c.destroy();
    const outcome = await Promise.race([
      abortedP,
      new Promise<string>((r) => setTimeout(() => r("timeout"), 2000)),
    ]);
    expect(outcome).toBe("aborted");
  });

  it("rejects a relative or missing cwd", async () => {
    const s = setup(okRun);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    for (const cwd of [".", join(s.dir, "nope")]) {
      const final = await sendRequest(s.sockPath, { type: "run", prompt: "x", cwd, depth: 0 }, () => {});
      expect(final.type).toBe("error");
    }
  });

  it("surfaces a config error instead of a silent start timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orch-"));
    const cfg = join(dir, "c.yaml");
    writeFileSync(cfg, "defaultAgent: nope\n");
    process.env.ORCH_CONFIG = cfg;
    try {
      await expect(connectOrStart(join(dir, "sock"), 500)).rejects.toThrow(/defaultAgent/);
    } finally {
      delete process.env.ORCH_CONFIG;
    }
  });

  it("returns an error message for invalid JSON", async () => {
    const s = setup(okRun);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    const reply = await new Promise<string>((resolve) => {
      const c = net.connect(s.sockPath, () => c.write("not json\n"));
      c.once("data", (d) => {
        resolve(d.toString());
        c.destroy();
      });
    });
    expect(JSON.parse(reply)).toMatchObject({ type: "error" });
  });
});
