import { spawn } from "node:child_process";
import type { RunFn, RunResult } from "./types.js";

export function renderArgs(args: string[], prompt: string): string[] {
  return args.map((a) => a.split("{prompt}").join(prompt));
}

export const runCommand: RunFn = (command, args, prompt, opts) =>
  new Promise<RunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };

    const child = spawn(command, renderArgs(args, prompt), {
      cwd: opts.cwd,
      env: { ...process.env, ORCH_DEPTH: String(opts.depth + 1) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ exitCode: null, stdout, stderr: `${stderr}\norch: timed out` });
      }, opts.timeoutMs);
    }

    const onAbort = () => {
      child.kill("SIGKILL");
      finish({ exitCode: null, stdout, stderr: `${stderr}\norch: aborted` });
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });

    // setEncoding decodes across chunk boundaries, so a multi-byte character is never split.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      stdout += text;
      opts.onChunk?.(text);
    });
    child.stderr.on("data", (text: string) => {
      stderr += text;
    });
    child.on("error", (err) =>
      finish({ exitCode: null, stdout, stderr: `orch: failed to start ${command}: ${err.message}` }),
    );
    child.on("close", (code) => finish({ exitCode: code, stdout, stderr }));
  });
