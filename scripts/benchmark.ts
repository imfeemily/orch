/**
 * Real-CLI benchmark: measures token use and cost with and without orch.
 * It calls the real `claude` and `codex` and spends real tokens (a few dollars).
 *
 *   npm run build && npm run benchmark -- [--only A,B,C,D] [--out benchmarks/results-DATE.json]
 *
 * A: model routing   B: orch overhead   C: handoff cost   D: fixed context per call
 * E: context presets (`--context lean`) against the default context
 * F: roles: one plain call against `--team standard` on the same task
 * G: the designer role on Codex (image files) and `--auto` on the same small task
 * H: `reviewer` and `security` in parallel against one at a time (wall time and cost)
 * Everything runs in temporary copies of a small seeded repository.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHandoff } from "../src/core/handoff.js";
import { parseAgentOutput } from "../src/core/output.js";
import type { Usage } from "../src/core/types.js";
import { billableTokens } from "../src/core/usage.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "dist/cli/index.js");
const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = new Set((flag("--only") ?? "A,B,C,D,E,F,G,H").split(","));
const date = new Date().toISOString().slice(0, 10);
const C_REPEATS = Number(flag("--c-repeats") ?? 1);
const SKIP_SUMMARY = args.includes("--skip-summary");
const OUT = resolve(flag("--out") ?? join(ROOT, `benchmarks/results-${date}.json`));

interface RunRecord {
  id: string;
  experiment: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
  task: string;
  variant: string;
  agent: "claude" | "codex";
  models: string[];
  usage?: Usage;
  billableTokens?: number;
  costUsd?: number;
  durationMs: number;
  success: boolean | null;
  promptChars?: number;
  note?: string;
  answerPreview?: string;
  /** tokens and cost per role, for team runs */
  perRole?: Record<string, { billableTokens: number; costUsd: number }>;
  /** image or diagram files an image role left in its assets directory */
  assetFiles?: string[];
  /** the roles automatic selection chose */
  autoRoles?: string[];
}

const records: RunRecord[] = [];
function save(rec: RunRecord): RunRecord {
  records.push(rec);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ meta: meta(), records }, null, 2));
  const tok = rec.billableTokens !== undefined ? `${rec.billableTokens} tokens` : "no usage";
  const cost = rec.costUsd !== undefined ? ` $${rec.costUsd.toFixed(4)}` : "";
  console.log(`[${rec.id}] ${tok}${cost} ${Math.round(rec.durationMs / 1000)}s success=${rec.success}${rec.note ? ` (${rec.note})` : ""}`);
  return rec;
}

function version(cmd: string): string {
  return spawnSync(cmd, ["--version"], { encoding: "utf8" }).stdout.trim().split("\n")[0];
}
function meta() {
  return { date, node: process.version, claude: version("claude"), codex: version("codex"), platform: process.platform };
}

// ---------- seeded repository ----------
const WORK = mkdtempSync(join(tmpdir(), "orch-bench-"));
const SEED = join(WORK, "seed");

function sh(cwd: string, cmd: string, argv: string[]): string {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}
function write(dir: string, file: string, content: string) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}
function commitAll(dir: string, msg: string) {
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["-c", "user.name=bench", "-c", "user.email=b@b", "commit", "-qm", msg]);
}

function seedRepo() {
  mkdirSync(SEED, { recursive: true });
  sh(SEED, "git", ["init", "-q"]);
  write(SEED, "README.md", "# Demo\n\nThis small library lets you recieve events and print a greeting.\n\n## Usage\n\nImport `greet` and `clamp` from `src/`.\n");
  write(SEED, "package.json", JSON.stringify({ name: "demo", type: "module", scripts: { test: "vitest run" } }, null, 2));
  write(SEED, "src/math.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function clamp(value: number, min: number, max: number): number {\n  if (value < min) return min;\n  if (value > max) return max;\n  return value;\n}\n");
  write(SEED, "src/greet.ts", 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n');
  write(SEED, "src/events.ts", "export type Handler = (payload: string) => void;\n\nexport class Emitter {\n  private handlers: Handler[] = [];\n  on(h: Handler): void {\n    this.handlers.push(h);\n  }\n  emit(payload: string): void {\n    for (const h of this.handlers) h(payload);\n  }\n}\n");
  commitAll(SEED, "seed");
}
function freshRepo(label: string): string {
  const dir = join(WORK, label);
  cpSync(SEED, dir, { recursive: true });
  return dir;
}

// ---------- runners ----------
interface Measured {
  usage?: Usage;
  costUsd?: number;
  models: string[];
  durationMs: number;
  text: string;
  error?: string;
  stderr?: string;
  entries?: Array<{ role?: string; usage?: Usage }>;
}

function claudeDirect(cwd: string, prompt: string, extra: string[] = [], head: string[] = []): Measured {
  const t0 = Date.now();
  const r = spawnSync("claude", [...head, "-p", "--output-format", "json", "--permission-mode", "acceptEdits", ...extra, "--", prompt], {
    cwd, encoding: "utf8", timeout: 600_000, maxBuffer: 50 * 1024 * 1024,
  });
  const out = parseAgentOutput("claude-json", r.stdout ?? "");
  let models: string[] = [];
  try {
    models = Object.keys(JSON.parse(r.stdout).modelUsage ?? {});
  } catch { /* not JSON */ }
  return { usage: out.usage, costUsd: out.usage?.costUsd, models, durationMs: Date.now() - t0, text: out.text, error: out.errorText ?? (r.status ? (r.stderr ?? "").slice(0, 200) : undefined) };
}

function codexDirect(cwd: string, prompt: string): Measured {
  const t0 = Date.now();
  const r = spawnSync("codex", ["exec", "--json", "--skip-git-repo-check", "-m", "gpt-6-luna", "-c", 'model_reasoning_effort="low"', "--", prompt], {
    cwd, encoding: "utf8", timeout: 600_000, maxBuffer: 50 * 1024 * 1024,
  });
  const out = parseAgentOutput("codex-jsonl", r.stdout ?? "");
  return { usage: out.usage, models: ["gpt-6-luna"], durationMs: Date.now() - t0, text: out.text, error: out.errorText };
}

/** Runs the task through the built `orch` CLI with its own throwaway ORCH_HOME and reads the ledger. */
function viaOrch(cwd: string, prompt: string, configYaml: string, extraCli: string[] = []): Measured {
  const home = mkdtempSync(join(WORK, "home-"));
  writeFileSync(join(home, "config.yaml"), configYaml);
  const env = { ...process.env, ORCH_HOME: home };
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [CLI, "run", "--cwd", cwd, ...extraCli, prompt], { env, encoding: "utf8", timeout: 600_000 });
  const durationMs = Date.now() - t0;
  spawnSync(process.execPath, [CLI, "daemon", "stop"], { env });
  const ledgerPath = join(home, "usage.jsonl");
  const entries = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const usage: Usage | undefined = entries.length
    ? entries.reduce(
        (acc: Usage, e: { usage?: Usage }) => ({
          inputTokens: acc.inputTokens + (e.usage?.inputTokens ?? 0),
          cacheReadTokens: acc.cacheReadTokens + (e.usage?.cacheReadTokens ?? 0),
          outputTokens: acc.outputTokens + (e.usage?.outputTokens ?? 0),
          costUsd: (acc.costUsd ?? 0) + (e.usage?.costUsd ?? 0),
        }),
        { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0 },
      )
    : undefined;
  const models = [...new Set(entries.map((e: { model?: string }) => e.model ?? "(default)"))] as string[];
  return {
    usage, costUsd: usage?.costUsd, models, durationMs, text: r.stdout ?? "",
    error: r.status ? (r.stderr ?? "").slice(0, 200) : undefined, stderr: r.stderr ?? "", entries,
  };
}

function record(id: string, experiment: RunRecord["experiment"], task: string, variant: string, agent: RunRecord["agent"], m: Measured, success: boolean | null, extra: Partial<RunRecord> = {}) {
  return save({
    id, experiment, task, variant, agent, models: m.models, usage: m.usage,
    billableTokens: m.usage ? billableTokens(m.usage) : undefined,
    costUsd: m.costUsd, durationMs: m.durationMs, success,
    note: m.error ? m.error.replace(/\s+/g, " ").slice(0, 160) : undefined,
    answerPreview: m.text.slice(0, 160), ...extra,
  });
}

// ---------- tasks ----------
const TASKS = {
  T1: {
    name: "fix a typo",
    prompt: "Fix the spelling mistake in README.md. Change only that word.",
    check: (dir: string, _text: string) => {
      const s = readFileSync(join(dir, "README.md"), "utf8");
      return s.includes("receive") && !s.includes("recieve");
    },
  },
  T2: {
    name: "write a small test",
    prompt: "Add a vitest test file at test/math.test.ts with tests for add() and clamp() from src/math.ts. Only create that file; do not run anything or install packages.",
    check: (dir: string, _text: string) => {
      const p = join(dir, "test/math.test.ts");
      if (!existsSync(p)) return false;
      const s = readFileSync(p, "utf8");
      return s.includes("clamp") && s.includes("add");
    },
  },
  T3: {
    name: "explain code",
    prompt: "Explain in three sentences or fewer what clamp() in src/math.ts does, including when it returns the lower bound. Do not modify files.",
    check: (_dir: string, text: string) => /min/i.test(text) && /(below|less than|under|smaller|lower|<)/i.test(text),
  },
} as const;

const ORCH_DEFAULT = `agents:
  claude:
    args: ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", "--", "{prompt}"]
    output: claude-json
`;
const ORCH_FAST = `${ORCH_DEFAULT}rules:
  - match: "spelling|explain|vitest"
    agent: claude
    model: haiku
    effort: low
`;

// ---------- experiments ----------
const dirs: Record<string, string> = {};

function expA() {
  for (const [key, t] of Object.entries(TASKS)) {
    const base = freshRepo(`A-${key}-base`);
    dirs[`A-${key}-base`] = base;
    const b = claudeDirect(base, t.prompt);
    record(`A-${key}-base`, "A", t.name, "claude default model, run directly", "claude", b, t.check(base, b.text));

    const routed = freshRepo(`A-${key}-fast`);
    const o = viaOrch(routed, t.prompt, ORCH_FAST);
    record(`A-${key}-fast`, "A", t.name, "orch rule: haiku + low effort", "claude", o, t.check(routed, o.text));
  }
}

function expB() {
  const t = TASKS.T1;
  const base = freshRepo("B-T1-base2");
  const b = claudeDirect(base, t.prompt);
  record("B-T1-base-repeat", "B", t.name, "claude default model, run directly (repeat)", "claude", b, t.check(base, b.text));

  const dir = freshRepo("B-T1-orch");
  const o = viaOrch(dir, t.prompt, ORCH_DEFAULT);
  record("B-T1-orch-default", "B", t.name, "same model, through orch (no rule)", "claude", o, t.check(dir, o.text));
}

const SUMMARY_PROMPT = "In under 200 words, summarize what you completed so far and what remains for the task you were working on.";
const FINISH = "\n\nDo not modify any files. Reply with only the number of files that have uncommitted changes.";

/** The handoff prompt as built before 0.2.1: diff up to 20,000 characters, plus a summary from the first agent. */
function oldHandoff(prompt: string, status: string, diff: string, summary: string): string {
  const MAX = 20_000;
  const shown = diff.length <= MAX ? diff : `${diff.slice(0, MAX)}\n... [diff truncated, ${diff.length - MAX} more chars]`;
  return [
    "You are continuing a task started by another coding agent (claude), which stopped because it failed.",
    `## Original task\n${prompt}`,
    `## Working tree status\n${status.trimEnd()}`,
    `## Diff so far\n${shown}`,
    `## Summary from previous agent\n${summary}`,
    "Continue from the current state of the working tree. Do not redo completed work.",
  ].join("\n\n");
}

async function expC() {
  // 1. real cost of the summary call that the old handoff made (resumes the last session in that directory)
  const sessionDir = dirs["A-T2-base"];
  let summary =
    "I created test/math.test.ts with tests for add() and clamp() covering normal values, values below the minimum, values above the maximum and values equal to the bounds. The file is complete. Nothing else remains for this task; the only follow-up is to run the test suite once vitest is installed in the project.";
  if (sessionDir && !SKIP_SUMMARY) {
    const s = claudeDirect(sessionDir, SUMMARY_PROMPT, [], ["-c"]);
    record("C-summary-call", "C", "handoff summary call", "claude -c -p resumes the previous session (old handoff only)", "claude", s, null);
    if (s.text.trim()) summary = s.text.trim();
  }

  // 2. a repository with a large uncommitted change
  const big = freshRepo("C-big");
  const rows = (word: string) => Array.from({ length: 400 }, (_, i) => `export const ROW_${i} = { id: ${i}, ${word}: "item number ${i}", group: "g${i % 7}" };`).join("\n");
  write(big, "src/table.ts", `${rows("label")}\n`);
  commitAll(big, "table");
  write(big, "src/table.ts", `${rows("title")}\n`);
  const diff = sh(big, "git", ["diff", "HEAD"]);
  const status = sh(big, "git", ["status", "--short"]);
  const task = "Rename the label field to title in src/table.ts.";

  const oldPrompt = `${oldHandoff(task, status, diff, summary)}${FINISH}`;
  const newPrompt = `${await buildHandoff({ prompt: task, cwd: big, previousAgent: "claude", reason: "failed" })}${FINISH}`;
  console.log(`handoff prompt sizes: old ${oldPrompt.length} chars, new ${newPrompt.length} chars (diff ${diff.length} chars)`);

  const variants = [
    ["old-handoff", "old handoff: diff up to 20,000 chars + summary", oldPrompt],
    ["new-handoff", "new handoff: git diff --stat, no summary", newPrompt],
  ] as const;
  for (let r = 0; r < C_REPEATS; r++) {
    // alternate the order so cache warmth does not favour one variant
    for (const [name, variant, prompt] of r % 2 === 0 ? variants : [variants[1], variants[0]]) {
      const m = codexDirect(big, prompt);
      record(`C-codex-${name}${C_REPEATS > 1 ? `-r${r + 1}` : ""}`, "C", "receiving agent continues after failover", variant, "codex", m, /\b1\b/.test(m.text), { promptChars: prompt.length });
    }
  }
}

function expD() {
  const probe = (id: string, variant: string, extra: string[]) => {
    const dir = freshRepo(id);
    const m = claudeDirect(dir, "reply with exactly the word pong and nothing else", extra);
    record(id, "D", "one-word answer", variant, "claude", m, /pong/i.test(m.text));
  };
  probe("D-claude-default", "claude, default context", []);
  probe("D-claude-bare", "claude --bare", ["--bare"]);
  probe("D-claude-safe", "claude --safe-mode", ["--safe-mode"]);
  probe("D-claude-no-skills", "claude --disable-slash-commands", ["--disable-slash-commands"]);
  const dir = freshRepo("D-codex");
  const m = codexDirect(dir, "reply with exactly the word pong and nothing else");
  record("D-codex-default", "D", "one-word answer", "codex, default context", "codex", m, /pong/i.test(m.text));
}

const ORCH_CODEX = `defaultAgent: codex
rules:
  - match: ".*"
    agent: codex
    model: gpt-6-luna
    effort: low
`;
const PONG = "reply with exactly the word pong and nothing else";

/** Same tasks, default model, default context against `--context lean`; order alternates so cache warmth does not favour one. */
function expE() {
  // warm each variant's prompt cache first (different flags mean different cached prefixes)
  viaOrch(freshRepo("E-warm-default"), PONG, ORCH_DEFAULT);
  viaOrch(freshRepo("E-warm-lean"), PONG, ORCH_DEFAULT, ["--context", "lean"]);
  let i = 0;
  for (const [key, t] of Object.entries(TASKS)) {
    const order = i++ % 2 === 0 ? ["default", "lean"] : ["lean", "default"];
    for (const variant of order) {
      const dir = freshRepo(`E-${key}-${variant}`);
      const o = viaOrch(dir, t.prompt, ORCH_DEFAULT, variant === "lean" ? ["--context", "lean"] : []);
      record(`E-${key}-${variant}`, "E", t.name, variant === "lean" ? "orch --context lean" : "orch, default context", "claude", o, t.check(dir, o.text));
    }
  }
  for (let r = 1; r <= 2; r++) {
    for (const variant of r === 1 ? ["default", "lean"] : ["lean", "default"]) {
      const dir = freshRepo(`E-codex-${variant}-${r}`);
      const o = viaOrch(dir, PONG, ORCH_CODEX, variant === "lean" ? ["--context", "lean"] : []);
      record(`E-codex-${variant}-${r}`, "E", "one-word answer", variant === "lean" ? "orch --context lean" : "orch, default context", "codex", o, /pong/i.test(o.text));
    }
  }
}

function perRole(entries: Measured["entries"]): RunRecord["perRole"] {
  const out: NonNullable<RunRecord["perRole"]> = {};
  for (const e of entries ?? []) {
    const key = e.role ?? "(none)";
    const row = out[key] ?? { billableTokens: 0, costUsd: 0 };
    if (e.usage) {
      row.billableTokens += billableTokens(e.usage);
      row.costUsd += e.usage.costUsd ?? 0;
    }
    out[key] = row;
  }
  return out;
}

/** The "write a small test" task as one plain call and as the standard team (developer, tester, reviewer). */
function expF() {
  const t = TASKS.T2;
  const plainDir = freshRepo("F-plain");
  const plain = viaOrch(plainDir, t.prompt, ORCH_DEFAULT);
  record("F-T2-plain", "F", t.name, "one plain call through orch", "claude", plain, t.check(plainDir, plain.text));

  const teamDir = freshRepo("F-team");
  const team = viaOrch(teamDir, t.prompt, "", ["--team", "standard"]);
  const allOk = ["developer ok", "tester ok", "reviewer ok"].every((s) => (team.stderr ?? "").includes(s));
  record("F-T2-standard-team", "F", t.name, "orch --team standard (developer, tester, reviewer)", "claude", team, t.check(teamDir, team.text) && allOk, {
    perRole: perRole(team.entries),
  });
}

/** Files left in any run's assets directory under a project. */
function findAssets(project: string): string[] {
  const out: string[] = [];
  try {
    const runs = join(project, ".orch", "runs");
    for (const id of readdirSync(runs)) {
      const dir = join(runs, id, "assets");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) out.push(join(dir, f));
    }
  } catch { /* no runs */ }
  return out;
}

/** The image role on Codex, and automatic role selection on the "write a small test" task. */
function expG() {
  const designDir = freshRepo("G-designer");
  const d = viaOrch(designDir, "Design a simple login screen mockup: an email field, a password field and a Sign in button, clean and minimal.", "", ["--role", "designer"]);
  const files = findAssets(designDir);
  record("G-designer", "G", "design a login screen mockup (image role)", "orch --role designer (Codex)", "codex", d, files.length > 0, { assetFiles: files.map((f) => f.split("/").pop() as string) });

  const t = TASKS.T2;
  const autoDir = freshRepo("G-auto");
  const a = viaOrch(autoDir, t.prompt, "", ["--auto"]);
  const line = (a.stderr ?? "").split("\n").find((l) => l.startsWith("auto: roles")) ?? "";
  const roles = line.replace("auto: roles", "").split(",").map((s) => s.trim()).filter(Boolean);
  record("G-auto", "G", t.name, "orch --auto", "claude", a, t.check(autoDir, a.text), { perRole: perRole(a.entries), autoRoles: roles });
}

/** A repository with a committed login module and an uncommitted change that has reviewable problems. */
function reviewRepo(label: string): string {
  const dir = freshRepo(label);
  write(dir, "src/auth.ts", "const users = new Map<string, string>();\n\nexport function register(name: string, hash: string): void {\n  users.set(name, hash);\n}\n\nexport function login(name: string, hash: string): boolean {\n  return users.get(name) === hash;\n}\n");
  commitAll(dir, "add auth");
  write(dir, "src/auth.ts", "import { db } from \"./db.js\";\n\nexport async function login(name: string, password: string): Promise<boolean> {\n  console.log(`login attempt ${name} ${password}`);\n  const rows = await db.query(\"SELECT * FROM users WHERE name = '\" + name + \"' AND password = '\" + password + \"'\");\n  return rows.length > 0;\n}\n");
  return dir;
}

/** The same two read-only roles run in parallel and one at a time; order alternates between rounds. */
function expH() {
  const task = "Review the login change in src/auth.ts for correctness and security.";
  const runOnce = (id: string, extra: string[], variant: string) => {
    const dir = reviewRepo(id);
    const m = viaOrch(dir, task, "", ["--roles", "reviewer,security", ...extra]);
    const ok = ["reviewer ok", "security ok"].every((s) => (m.stderr ?? "").includes(s));
    record(id, "H", "review a login change with reviewer and security", variant, "claude", m, ok, { perRole: perRole(m.entries) });
  };
  runOnce("H-parallel-1", [], "parallel (default)");
  runOnce("H-sequential-1", ["--sequential"], "--sequential");
  runOnce("H-sequential-2", ["--sequential"], "--sequential");
  runOnce("H-parallel-2", [], "parallel (default)");
}

async function main() {
  if (!existsSync(CLI)) throw new Error("dist/ is missing: run `npm run build` first");
  console.log(`Benchmark: spends real tokens. Experiments: ${[...only].join(", ")}. Output: ${OUT}`);
  seedRepo();
  const steps: Array<[string, () => void | Promise<void>]> = [["A", expA], ["B", expB], ["C", expC], ["D", expD], ["E", expE], ["F", expF], ["G", expG], ["H", expH]];
  for (const [name, fn] of steps) {
    if (!only.has(name)) continue;
    console.log(`\n== Experiment ${name}`);
    try {
      await fn();
    } catch (e) {
      console.error(`experiment ${name} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\nDone. ${records.length} runs saved to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
