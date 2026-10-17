import { chmodSync, mkdirSync, mkdtempSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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

function setup(run: RunFn, auto?: boolean) {
  // keep the path short: unix socket paths are limited to ~104 chars on macOS
  const dir = mkdtempSync(join(tmpdir(), "orch-"));
  const sockPath = join(dir, "sock");
  const config = { ...DEFAULT_CONFIG, agents: { ...DEFAULT_CONFIG.agents, claude: { ...DEFAULT_CONFIG.agents.claude, output: "text" as const } } };
  if (auto) config.auto = { enabled: true, maxRoles: 3 };
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

  it("forwards context to the run and reports an unknown context as rejected", async () => {
    const seen: string[][] = [];
    const run: RunFn = async (_c, args) => {
      seen.push(args);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const s = setup(run);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    await sendRequest(s.sockPath, { type: "run", prompt: "x", cwd: s.dir, depth: 0, context: "lean" }, () => {});
    expect(seen[0]).toContain("--setting-sources");
    const bad = await sendRequest(s.sockPath, { type: "run", prompt: "x", cwd: s.dir, depth: 0, context: "nope" }, () => {});
    expect(bad.type === "result" && bad.result.status).toBe("rejected");
  });

  it("runs a team through the daemon, in order, and plans without running on dryRun", async () => {
    const seen: string[] = [];
    const run: RunFn = async (_c, _a, prompt) => {
      seen.push(prompt);
      return { exitCode: 0, stdout: "ok\n## Handoff\nnote", stderr: "" };
    };
    const s = setup(run);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    const team = await sendRequest(s.sockPath, { type: "run", prompt: "add tests", cwd: s.dir, depth: 0, team: "standard" }, () => {});
    expect(team.type === "result" && team.result.roles?.map((r) => r.role)).toEqual(["developer", "tester", "reviewer"]);
    expect(seen).toHaveLength(3);
    expect(seen[0]).toContain(DEFAULT_CONFIG.roles.developer.prompt);

    seen.length = 0;
    const dry = await sendRequest(s.sockPath, { type: "run", prompt: "add tests", cwd: s.dir, depth: 0, team: "quick", dryRun: true }, () => {});
    expect(dry.type === "result" && dry.result.status).toBe("planned");
    expect(seen).toHaveLength(0);

    const bad = await sendRequest(s.sockPath, { type: "run", prompt: "x", cwd: s.dir, depth: 0, role: "reviewer", team: "quick" }, () => {});
    expect(bad.type === "result" && bad.result.status).toBe("rejected");

    // role-only flags without a selector are rejected, not silently ignored
    const alone = await sendRequest(s.sockPath, { type: "run", prompt: "x", cwd: s.dir, depth: 0, requireCodex: true }, () => {});
    expect(alone.type === "result" && alone.result.status).toBe("rejected");
    expect(seen).toHaveLength(0);
  });

  it("selects roles automatically when auto.enabled or auto is requested, and stays plain otherwise", async () => {
    const seen: string[] = [];
    const run: RunFn = async (_c, _a, prompt) => {
      seen.push(prompt);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const on = setup(run, true);
    closers.push((await startDaemon({ sockPath: on.sockPath, deps: on.deps })).close);
    const change = await sendRequest(on.sockPath, { type: "run", prompt: "fix the typo", cwd: on.dir, depth: 0 }, () => {});
    expect(change.type === "result" && change.result.selection?.roles).toEqual(["developer", "tester"]);
    expect(seen).toHaveLength(2);

    seen.length = 0;
    await sendRequest(on.sockPath, { type: "run", prompt: "explain the router", cwd: on.dir, depth: 0 }, () => {});
    expect(seen).toEqual(["explain the router"]);

    seen.length = 0;
    await sendRequest(on.sockPath, { type: "run", prompt: "fix the typo", cwd: on.dir, depth: 0, auto: false }, () => {});
    expect(seen).toEqual(["fix the typo"]);

    seen.length = 0;
    await sendRequest(on.sockPath, { type: "run", prompt: "fix the typo", cwd: on.dir, depth: 0, team: "quick" }, () => {});
    expect(seen).toHaveLength(1); // an explicit team beats auto.enabled
    expect(seen[0]).toContain(DEFAULT_CONFIG.roles.developer.prompt);
  });

  it("rejects auto together with an explicit selector, and plain runs do not use auto when disabled", async () => {
    const seen: string[] = [];
    const run: RunFn = async (_c, _a, prompt) => {
      seen.push(prompt);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const off = setup(run);
    closers.push((await startDaemon({ sockPath: off.sockPath, deps: off.deps })).close);
    const bad = await sendRequest(off.sockPath, { type: "run", prompt: "x", cwd: off.dir, depth: 0, auto: true, team: "quick" }, () => {});
    expect(bad.type === "result" && bad.result.status).toBe("rejected");
    await sendRequest(off.sockPath, { type: "run", prompt: "fix the typo", cwd: off.dir, depth: 0 }, () => {});
    expect(seen).toEqual(["fix the typo"]);
  });

  it("runs read-only roles in parallel unless sequential is requested", async () => {
    let inFlight = 0;
    let max = 0;
    const run: RunFn = async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const s = setup(run);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    await sendRequest(s.sockPath, { type: "run", prompt: "x", cwd: s.dir, depth: 0, roles: ["reviewer", "security"] }, () => {});
    expect(max).toBe(2);
    max = 0;
    await sendRequest(s.sockPath, { type: "run", prompt: "x", cwd: s.dir, depth: 0, roles: ["reviewer", "security"], sequential: true }, () => {});
    expect(max).toBe(1);
    const alone = await sendRequest(s.sockPath, { type: "run", prompt: "x", cwd: s.dir, depth: 0, sequential: true }, () => {});
    expect(alone.type === "result" && alone.result.status).toBe("rejected");
  });

  it("reads a request whose multi-byte character is split across packets", async () => {
    const seen: string[] = [];
    const run: RunFn = async (_c, _a, prompt) => {
      seen.push(prompt);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const s = setup(run);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    const bytes = Buffer.from(`${JSON.stringify({ type: "run", prompt: "ก", cwd: s.dir, depth: 0 })}\n`);
    const cut = bytes.indexOf(0xe0) + 1;
    await new Promise<void>((resolve) => {
      const c = net.connect(s.sockPath, () => {
        c.write(bytes.subarray(0, cut));
        setTimeout(() => c.write(bytes.subarray(cut)), 60);
      });
      c.on("data", () => {
        c.destroy();
        resolve();
      });
    });
    expect(seen).toEqual(["ก"]);
  });

  it("leaves a newer daemon's socket alone when an older daemon shuts down late", async () => {
    const s = setup(okRun);
    const older = await startDaemon({ sockPath: s.sockPath, deps: s.deps });
    unlinkSync(s.sockPath); // a replacement daemon takes over the path
    const newer = await startDaemon({ sockPath: s.sockPath, deps: s.deps });
    closers.push(newer.close);
    await older.close();
    expect(await isAlive(s.sockPath)).toBe(true);
  });

  it("lets only one of two daemons that start at the same time win", async () => {
    const s = setup(okRun);
    const results = await Promise.allSettled([
      startDaemon({ sockPath: s.sockPath, deps: s.deps }),
      startDaemon({ sockPath: s.sockPath, deps: s.deps }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason)).toMatch(/already (running|starting)/);
    closers.push((won[0] as PromiseFulfilledResult<{ close(): Promise<void> }>).value.close);
    expect(await isAlive(s.sockPath)).toBe(true);
  });

  it("tightens an existing state directory to owner-only", async () => {
    const s = setup(okRun);
    mkdirSync(s.dir, { recursive: true });
    chmodSync(s.dir, 0o755);
    closers.push((await startDaemon({ sockPath: s.sockPath, deps: s.deps })).close);
    expect(statSync(s.dir).mode & 0o777).toBe(0o700);
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
