# Model control, Stage 1: measure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse each agent's JSON output into a clean answer plus token usage, record every attempt in a local ledger, and report it with `orch usage`.

**Architecture:** Pure parsers (`output.ts`) and a ledger (`usage.ts`) in `src/core`, wired into `runTask`. Classification runs on the parsed error text instead of raw JSON. The CLI reads the ledger file directly, so no protocol change is needed. Stages 2-4 (tiers, difficulty estimate, quota routing) get their own plans after this ships.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-17-model-control-design.md` (Stage 1 and "Verified facts")

## Global Constraints

- Node.js >= 20; TypeScript strict; ESM with `.js` import extensions; `src/core` imports nothing from `daemon`, `cli` or `mcp`.
- Automated tests never call the real `claude` or `codex`; fixtures are captured once from real output.
- A config written for 0.2.x must keep working: parsing falls back to `text` with no usage when the output is not the expected JSON.
- Ledger file: `~/.orch/usage.jsonl` (`orchHome()`); trimmed to the last 90 days on daemon start; **ledger writes never fail a task**.
- Quota unit: `billableTokens = inputTokens + outputTokens`, where `inputTokens` excludes cache reads.
- Summary (handoff v2) calls keep their current text-mode `summaryArgs` and are parsed with the same fallback.
- Code and docs change together (`AGENTS.md`): `docs-coverage.test.ts` fails until new commands and config keys are documented in `docs/guide` and `docs/th/guide`.
- Commit messages use `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## Review Focus

1. Claude failure is `exit 1`, stdout JSON with `is_error: true`, empty stderr: classification must use `result` (Task 4 test with the real error fixture).
2. Codex failure arrives as `error` / `turn.failed` events with a JSON-string `message`, and an `item.completed` of type `error` is only a warning: a successful run with that warning must not be treated as failed (Task 1 test).
3. Truncated or garbage stdout (agent killed mid-output) must fall back to text and never throw (Task 1 test).
4. Words like "rate limit" inside a successful or long answer must not trigger a cooldown (Task 4 test).
5. Corrupt ledger lines, an unwritable ledger path, and an invalid `--since` must not break tasks or `orch usage` (Tasks 2 and 6 tests).

---

### Task 1: Parse agent output

**Files:**
- Create: `src/core/output.ts`, `test/output.test.ts`, `test/fixtures/claude-success.json`, `claude-error.json`, `codex-success.jsonl`, `codex-error.jsonl`
- Modify: `src/core/types.ts`

**Interfaces:**
- Produces in `types.ts`: `type OutputKind = "claude-json" | "codex-jsonl" | "text"`; `interface Usage { inputTokens: number; cacheReadTokens: number; outputTokens: number; reasoningTokens?: number; costUsd?: number }`; `interface AgentOutput { text: string; errorText?: string; usage?: Usage }`.
- Produces in `output.ts`: `parseAgentOutput(kind: OutputKind, stdout: string): AgentOutput`.

- [ ] **Step 1: Capture fixtures** from the real CLIs (run inside this repo, exit codes of the error cases are 1):
  `claude -p --model haiku --output-format json -- "reply with exactly the word pong" > test/fixtures/claude-success.json`; `claude -p --model not-a-real-model --output-format json -- "pong" > test/fixtures/claude-error.json`; `codex exec -m gpt-6-luna --json -- "reply with exactly the word pong" 2>/dev/null > test/fixtures/codex-success.jsonl`; `codex exec -m not-a-real-model --json -- "pong" 2>/dev/null > test/fixtures/codex-error.jsonl`. Confirm each file is non-empty and parses.
- [ ] **Step 2: Write `test/output.test.ts`** (fixtures read from disk, plus inline strings):
  - claude success fixture: `text === "pong"`, `errorText` undefined, `usage.outputTokens > 0`, `usage.costUsd > 0`.
  - claude error fixture: `errorText` contains `not-a-real-model`.
  - Claude usage mapping from an inline object: `input_tokens 10, cache_creation_input_tokens 100, cache_read_input_tokens 5, output_tokens 7` gives `inputTokens 110`, `cacheReadTokens 5`, `outputTokens 7`.
  - codex success fixture: `text === "pong"`, usage present, `errorText` undefined.
  - Codex usage mapping from inline JSONL with `input_tokens 21613, cached_input_tokens 12544, output_tokens 5, reasoning_output_tokens 0`: `inputTokens 9069`, `cacheReadTokens 12544`, `outputTokens 5`.
  - codex error fixture: `errorText` contains `not-a-real-model` and is the inner message, not the raw JSON string.
  - Codex success with an `item.completed` of `type: "error"` warning before the `agent_message`: `errorText` undefined, `text` is the message.
  - Fallback: for each of `claude-json` and `codex-jsonl`, input `"plain text answer"` and input `'{"result": "cut off'` return `{ text: <the input> }` with no usage and no throw; `kind: "text"` returns the input unchanged.
- [ ] **Step 3: Run** `npx vitest run test/output.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Add the types** to `types.ts` and implement `parseAgentOutput`. `claude-json`: parse the whole trimmed stdout as one object; `text = result`; `errorText = result` when `is_error`; usage and `costUsd` (`total_cost_usd`) as in the test. `codex-jsonl`: parse each non-empty line, ignore non-JSON lines; if no line parses fall back; `text` = last `agent_message` text; usage from the last `turn.completed`; `errorText` joins the distinct messages of `error` and `turn.failed` events, unwrapping `error.message` when the message is itself a JSON string. Any shape mismatch falls back to `{ text: stdout }`.
- [ ] **Step 5: Run** `npx vitest run test/output.test.ts && npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 6: Commit** `feat: parse claude and codex JSON output into text, error and usage`.

### Task 2: Ledger and usage summaries

**Files:**
- Create: `src/core/usage.ts`, `test/usage.test.ts`

**Interfaces:**
- Consumes: `Usage`, `AgentName`, `Outcome`.
- Produces: `billableTokens(u: Usage): number`; `interface LedgerEntry { at: number; taskId: string; agent: AgentName; model?: string; outcome: Outcome; usage?: Usage; durationMs: number; promptChars: number }`; `class Ledger { constructor(path: string); append(entry: LedgerEntry): void; readSince(sinceMs: number): LedgerEntry[]; trim(keepMs: number, now?: number): void }`; `interface UsageRow { key: string; tasks: number; inputTokens: number; cacheReadTokens: number; outputTokens: number; billableTokens: number; costUsd: number }`; `summarize(entries: LedgerEntry[], by: "agent" | "model"): UsageRow[]`; `parseDuration(text: string): number | null`.

- [ ] **Step 1: Write `test/usage.test.ts`:**
  - `billableTokens({inputTokens: 10, cacheReadTokens: 999, outputTokens: 5})` is 15.
  - `append` then `readSince(0)` round-trips an entry; `readSince(t)` returns only entries with `at >= t`; the file is created in a missing directory.
  - A file with a corrupt line between two valid lines returns the two valid entries.
  - `append` to an unwritable path (a path under a regular file) does not throw.
  - `trim(keepMs, now)` removes older entries and keeps newer ones, and is a no-op for a missing file.
  - `summarize(..., "agent")` sums tokens and cost per agent, counts tasks, sorts by `billableTokens` descending; an entry without `usage` counts as a task with zero tokens; `by: "model"` labels a missing model `(default)`.
  - `parseDuration`: `"30m"` is 1800000, `"24h"` is 86400000, `"7d"` is 604800000; `"abc"`, `"10"`, `"0h"` and `""` return `null`.
- [ ] **Step 2: Run** `npx vitest run test/usage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/core/usage.ts` per the Interfaces block (JSON Lines file; `append` swallows filesystem errors; `readSince` skips unparsable lines; `trim` rewrites atomically via temp file and rename).
- [ ] **Step 4: Run** `npx vitest run test/usage.test.ts && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add usage ledger and summaries`.

### Task 3: `output` config key and JSON default args

**Files:**
- Modify: `src/core/types.ts`, `src/core/config.ts`, `config.example.yaml`, `test/config.test.ts`, `test/agent-args.test.ts`

**Interfaces:**
- Consumes: `OutputKind`.
- Produces: `AgentConfig.output: OutputKind`. Defaults: Claude `args: ["-p", "--output-format", "json", "--", "{prompt}"]`, `output: "claude-json"`; Codex `args: ["exec", "--json", "--", "{prompt}"]`, `output: "codex-jsonl"`. `summaryArgs` unchanged.

- [ ] **Step 1: Update tests first.** In `agent-args.test.ts` change the expected arrays to include the JSON flags (model/effort flags still land before `--`). In `config.test.ts` add: default agents have the `output` kinds above; a config setting `agents.claude.output: text` loads; `output: yaml` is rejected with an error naming `output`.
- [ ] **Step 2: Run** `npx vitest run test/config.test.ts test/agent-args.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:** add `output` to `AgentConfig`, set the defaults, validate it against the three kinds in `validate()`, update `config.example.yaml`.
- [ ] **Step 4: Run** `npx vitest run test/config.test.ts test/agent-args.test.ts test/reference.test.ts && npx tsc --noEmit`. Expected: PASS (`docs-coverage` will fail until Task 7; that is expected and is not run here).
- [ ] **Step 5: Commit** `feat: add output config key and JSON default args`.

### Task 4: Orchestrator uses parsed output and writes the ledger

**Files:**
- Modify: `src/core/types.ts` (`Attempt.usage?`, `Attempt.model?`, `TaskResult.usage?`), `src/core/orchestrator.ts` (`Deps.ledger?: Ledger`)
- Test: `test/orchestrator-output.test.ts` (new), existing orchestrator tests stay green

**Interfaces:**
- Consumes: `parseAgentOutput`, `Ledger`, `LedgerEntry`, `relevantText`, `classify`.
- Produces: `runTask` returns `output` = parsed `text` of the final attempt, `usage` of the final attempt; one `LedgerEntry` per attempt when `deps.ledger` is set (`taskId` = 8-character id per `runTask` call, `model` = the rule's model when that agent was the routed one, `promptChars` = `req.prompt.length`, `durationMs` measured with `deps.now`).

- [ ] **Step 1: Write `test/orchestrator-output.test.ts`** with a fake `RunFn` returning fixture stdout for the default (JSON) config and a `Ledger` on a temp dir:
  - Success with the claude fixture: `status "ok"`, `output === "pong"`, `usage` present, one ledger entry with `agent "claude"`, `outcome "ok"`, and usage.
  - Claude error JSON (`is_error true`, exit 1, empty stderr) whose `result` is `Failed to authenticate: OAuth session expired`: first attempt outcome is `auth`; with `result` `You've hit your usage limit` it is `limited` and sets a cooldown; with the real `claude-error.json` it is `failed`.
  - A failed run whose JSON `result` mentions "rate limit" in the first line followed by 25 other lines stays `failed` (Review Focus 4).
  - Codex error events with a `usage limit` message classify as `limited`.
  - `onChunk` is not called for JSON agents and is called for an agent configured with `output: "text"`.
  - Non-JSON stdout from a JSON agent still returns that text as `output` with no `usage` (fallback).
  - Failover: two ledger entries with the same `taskId`; with `ledger` absent no error; with a `Ledger` whose path is unwritable the task result is unchanged.
  - The summary call's returned text is parsed (JSON fixture in, plain answer in the handoff prompt).
- [ ] **Step 2: Run** `npx vitest run test/orchestrator-output.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement in `runAttempt`:** parse stdout with the agent's `output` kind; classify and extract the reset time from `{ exitCode, stdout: errorText ?? text, stderr }` after the existing prompt scrub; forward `onChunk` only when `cfg.output === "text"`; build `Attempt` with `usage` and `model`; append the ledger entry. Parse the summary output the same way in `requestSummary`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: all PASS (older orchestrator tests pass through the text fallback).
- [ ] **Step 5: Commit** `feat: classify on parsed agent output and record usage in the ledger`.

### Task 5: Daemon and CLI wiring

**Files:**
- Create: `src/cli/render.ts`, `test/render.test.ts`
- Modify: `src/daemon/index.ts`, `src/cli/index.ts`

**Interfaces:**
- Produces: `finalOutputToPrint(streamed: boolean, output: string): string` (empty when `streamed` or `output` is empty; otherwise `output` with exactly one trailing newline).

- [ ] **Step 1: Write `test/render.test.ts`:** streamed returns `""`; empty output returns `""`; `"pong"` returns `"pong\n"`; `"pong\n"` returns `"pong\n"`.
- [ ] **Step 2: Run** `npx vitest run test/render.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `finalOutputToPrint`. In `cli/index.ts` `run`: remember whether any chunk was written and print `finalOutputToPrint(streamed, result.output)` after the result. In `daemon/index.ts`: create `new Ledger(join(home, "usage.jsonl"))`, pass it in `deps`, and call `trim(90 * 86_400_000)` once at start.
- [ ] **Step 4: Run** `npx vitest run && npm run build`. Expected: PASS, build clean.
- [ ] **Step 5: Commit** `feat: print final answer and wire the ledger into the daemon`.

### Task 6: `orch usage`, status tokens, MCP footer

**Files:**
- Create: `src/cli/usage-report.ts`, `test/usage-report.test.ts`
- Modify: `src/cli/args.ts`, `src/cli/usage.ts`, `src/cli/index.ts`, `src/mcp/index.ts`, `test/args.test.ts`

**Interfaces:**
- Consumes: `Ledger`, `summarize`, `parseDuration`, `UsageRow`.
- Produces: `Command` gains `{ name: "usage"; since: string; by: "agent" | "model" }` (defaults `"24h"`, `"agent"`); `formatUsage(rows: UsageRow[], since: string): string`.

- [ ] **Step 1: Write tests.** `args.test.ts`: `usage` gives the defaults; `usage --since 7d --by model` is parsed; `--by tier` throws naming `agent` and `model`; `--since abc` throws mentioning `--since` (validated in the parser with `parseDuration`). `usage-report.test.ts`: `formatUsage([], "24h")` says `no usage recorded in the last 24h`; one row prints its key, task count and billable tokens with thousands separators, and cost with 4 decimals only when greater than 0.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement** the parser case, `formatUsage`, the `USAGE` line `orch usage [--since 24h|7d] [--by agent|model]   token usage from the ledger`, and the CLI case that reads `new Ledger(join(orchHome(), "usage.jsonl"))` directly: the parser rejects an invalid `--since` with `invalid --since: expected a number and unit like 30m, 24h or 7d`. `orch status` also prints `tokens (24h): claude N, codex N`. The MCP `orch_run` footer appends `tokens=<billable>` when the result has usage.
- [ ] **Step 4: Run** `npx vitest run test/args.test.ts test/usage-report.test.ts test/mcp.test.ts && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add orch usage and token counts in status and MCP footer`.

### Task 7: Documentation and real-CLI smoke test

**Files:**
- Modify: `docs/guide/usage.md`, `docs/guide/configuration.md`, `docs/guide/troubleshooting.md`, `docs/th/guide/` (the same three), `docs/developer/architecture.md`, `docs/developer/testing.md`, `README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-10-17-model-control-design.md`

- [ ] **Step 1: Update docs** per `docs/developer/docs-policy.md`: `orch usage` and the status token line (usage guide, English and Thai); the `output` key and the new default `args` (configuration, English and Thai, including that overriding `args` without the JSON flag falls back to text with no usage); parse-fallback note in troubleshooting; new modules `output.ts` and `usage.ts` and the changed data flow in architecture; fixtures in testing; `CHANGELOG.md` entry under Unreleased.
- [ ] **Step 2: Update the spec** to match what was built: quota unit is `inputTokens + outputTokens` (reasoning is already inside `output_tokens`), and summaries keep text-mode `summaryArgs`, which resolves the open `-c` item.
- [ ] **Step 3: Run** `npm test && npm run docs:build`. Expected: all tests PASS (including `docs-coverage`), build completes with no dead links.
- [ ] **Step 4: Smoke test** with a throwaway `ORCH_HOME` and inside this repository: `orch run "reply with exactly the word pong and nothing else"` prints `pong` once; `orch usage` shows one task with non-zero tokens for the agent used; `orch usage --by model` runs; setting `agents.claude.command: /usr/bin/false` and re-running shows a failover and two ledger lines with the same `taskId` (`cat $ORCH_HOME/usage.jsonl`); `orch daemon stop` afterwards.
- [ ] **Step 5: Commit** `docs: document usage ledger, orch usage and the output key`.

---

## Self-Review Notes

- **Spec coverage (Stage 1):** JSON output + parser fallback (T1, T3), classify on parsed text (T4), ledger and trim (T2, T5), `orch usage` and status tokens (T6), MCP compact result and footer (T4 output, T6 footer), docs (T7). Stages 2-4 are intentionally out of this plan.
- **Spec change:** quota unit excludes a separate reasoning term and summaries stay text-mode (recorded in T7 Step 2).
- **Type consistency:** `Usage`, `AgentOutput`, `OutputKind` (T1) are used unchanged in T2-T6; `LedgerEntry` and `Ledger` (T2) are used in T4-T6.
