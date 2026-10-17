# Roles, Phase 3 (parallel read-only roles) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run adjacent read-only roles of a team at the same time (for example `reviewer` and `security`), so a team finishes sooner, without changing cost or the order in which results and handoffs are reported.

**Architecture:** The team runner groups consecutive roles with `writes: false` into batches of at most `pipeline.maxParallel`, starts each batch together with `Promise.all`, then folds the finished results back in plan order. Roles that write still run alone. Everything else (routing, failover, ledger, artifacts, readiness) is the existing per-role `runTask` path.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-17-roles-design.md` (Phase 3 in "Delivery"; "Pipeline" says read-only roles may run in parallel)

## Global Constraints

- Node.js >= 20; strict TypeScript; `.js` import extensions; `src/core` imports nothing from `daemon`, `cli` or `mcp`.
- Automated tests never call the real `claude` or `codex`.
- Only roles with `writes: false` run in parallel, and only when adjacent in the plan; a role with `writes: true` always runs alone, and nothing runs in parallel with it.
- New config: `pipeline.parallel` (boolean, default `true`), `pipeline.maxParallel` (integer >= 1, default `2`); `--sequential` forces one-at-a-time for a run.
- Parallel changes time, not cost: every role is still one call; results, artifacts, ledger entries and the summary are reported in plan order.
- Roles in a parallel batch receive the same earlier handoffs and never see each other's.
- A failure inside a batch does not cancel its siblings; the team then stops (unless `--keep-going`) and later roles are `not-run`. Abort cancels everything not yet finished and the rest.
- Code and docs change together (`AGENTS.md`); `docs-coverage.test.ts` must stay green in every task that adds a flag or config key.
- Commit prefixes: `feat:`, `fix:`, `docs:`, `test:`.

## Review Focus

1. Writers never overlap with anything; only adjacent `writes: false` roles are batched, and batches respect `maxParallel` (Task 2).
2. One failing role in a batch still lets its siblings finish and be recorded; the team then stops and reports the rest `not-run` (Task 2).
3. Results, artifacts, handoffs and outputs are in plan order regardless of which call finishes first (Task 2).
4. `--sequential` and `pipeline.parallel: false` give exactly the Phase 2 sequential behavior (Tasks 2, 3).
5. A role that is skipped for readiness does not occupy a parallel slot, and an abort during a batch cancels the rest (Task 2).

---

### Task 1: Config

**Files:**
- Modify: `src/core/types.ts`, `src/core/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `Config.pipeline: { handoffChars: number; parallel: boolean; maxParallel: number }`; defaults `{ handoffChars: 4000, parallel: true, maxParallel: 2 }`.

- [ ] **Step 1: Write failing tests:** defaults include `parallel: true` and `maxParallel: 2`; a user `pipeline: { parallel: false, maxParallel: 3 }` merges and keeps `handoffChars`; rejected naming the key: `pipeline.parallel: "yes"`, `pipeline.maxParallel: 0`, `pipeline.maxParallel: 1.5`, and an unknown key `pipeline.threads`.
- [ ] **Step 2: Run** `npx vitest run test/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the type, defaults, the `mergeKnown` key list and the validation in `config.ts`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: PASS except `docs-coverage` (fixed in Task 4).
- [ ] **Step 5: Commit** `feat: add pipeline.parallel and pipeline.maxParallel`.

### Task 2: Parallel batches in the team runner

**Files:**
- Modify: `src/core/team.ts`, `src/core/types.ts` (`PlanStep.group?: number`)
- Test: `test/team.test.ts`

**Interfaces:**
- Consumes: `Config.pipeline`, `RoleConfig.writes`.
- Produces: `TeamRequest.sequential?: boolean`; `groupSteps(steps: PlanStep[], config: Config, parallel: boolean): PlanStep[][]` (exported for tests); `PlanStep.group` set to a shared number for every step of a batch with more than one member, in dry-run plans too.

- [ ] **Step 1: Write failing tests** (fake `RunFn` that records start and end order and the highest number of calls in flight, using deferred promises so completion order can be controlled):
  - `standard` team: `developer` and `tester` run alone, `reviewer` and `security` (a custom team `[developer, reviewer, security]`) overlap: the maximum concurrency is 2 and it happens only for the last two.
  - `groupSteps`: writers always form single-member groups; adjacent `writes: false` roles are batched up to `maxParallel`; `parallel: false` gives all single groups.
  - Results, artifacts, `outputs` sections and later handoffs follow plan order even when the second role finishes first.
  - Both roles of a batch receive identical earlier handoffs and neither sees the other's.
  - A failing role in a batch does not stop its sibling from finishing and being recorded; the status is `failed`; with a following role it is `not-run`; with `keepGoing` the following role runs.
  - `sequential: true` and `pipeline.parallel: false` both give maximum concurrency 1 and the same results as before.
  - A skipped role (readiness) does not count against `maxParallel`: with `maxParallel: 2` and three read-only roles where one is skipped, the other two run together.
  - `maxParallel: 1` behaves sequentially; three read-only roles with `maxParallel: 2` run as a batch of two then one.
  - Abort while a batch runs: roles after the batch are `not-run`.
  - `dryRun` marks batch members with the same `group` number and single roles with none.
- [ ] **Step 2: Run** `npx vitest run test/team.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Compute groups once from the plan steps; for each group: apply the abort and earlier-failure rules to every member, recheck readiness for runnable members that need a capability, run the runnable ones concurrently (`Promise.all`) with the shared handoff snapshot, then fold results in plan order (artifacts, handoffs, outputs, messages, status). Keep the single-role and dry-run paths unchanged except for `group` in the plan.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: PASS except `docs-coverage`.
- [ ] **Step 5: Commit** `feat: run adjacent read-only roles in parallel`.

### Task 3: Daemon, CLI and MCP wiring

**Files:**
- Modify: `src/daemon/protocol.ts`, `src/daemon/server.ts`, `src/cli/args.ts`, `src/cli/usage.ts`, `src/cli/index.ts`, `src/cli/plan-report.ts`, `src/mcp/index.ts`
- Test: `test/args.test.ts`, `test/plan-report.test.ts`, `test/daemon.test.ts`, `test/mcp.test.ts`

**Interfaces:**
- Produces: `--sequential` for `orch run`; request and MCP field `sequential?: boolean`; `formatPlan` shows `(parallel with <roles>)` for batch members.

- [ ] **Step 1: Write failing tests:** `--sequential` parses; `plan-report` shows the parallel note for steps sharing a `group`; the daemon passes `sequential` through (a team with two read-only roles runs them one at a time when set); MCP `orch_run` accepts `sequential`.
- [ ] **Step 2: Run** the test files. Expected: FAIL.
- [ ] **Step 3: Implement** the flag, the protocol and request field, the pass-through in the server and MCP, the plan-report note and the `USAGE` line.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: PASS except `docs-coverage`.
- [ ] **Step 5: Commit** `feat: expose --sequential through the daemon, CLI and MCP`.

### Task 4: Documentation

**Files:**
- Modify: `docs/guide/roles.md`, `docs/guide/usage.md`, `docs/guide/configuration.md`, the Thai twins, `docs/developer/architecture.md`, `docs/developer/testing.md`, `CHANGELOG.md`, `test/docs-coverage.test.ts`

- [ ] **Step 1: Extend `docs-coverage.test.ts`:** config keys gain `parallel`, `maxParallel`; usage must contain `--sequential`. Run it: FAIL.
- [ ] **Step 2: Write the docs** (English and Thai): the Roles page (what runs in parallel and why only read-only roles, the same-handoff rule, failure behavior, `--sequential`, the cost note that parallel saves time not tokens, the status note updated), configuration keys, usage flag, architecture (grouping), testing, `CHANGELOG.md`.
- [ ] **Step 3: Run** `npm test && npm run docs:build`. Expected: PASS, no dead links.
- [ ] **Step 4: Commit** `docs: document parallel read-only roles`.

### Task 5: Real-CLI measurement

**Files:**
- Modify: `scripts/benchmark.ts`, `docs/guide/benchmarks.md`, `docs/th/guide/benchmarks.md`
- Create: `benchmarks/results-<date>-parallel.json` (generated)

- [ ] **Step 1: Free checks:** `orch run --roles reviewer,security --dry-run "..."` shows the parallel note; with `--sequential` it does not; `pipeline.parallel: false` removes it.
- [ ] **Step 2: Add experiment H** to `scripts/benchmark.ts`: a seeded repository with a small uncommitted change; run `--roles reviewer,security` in parallel and with `--sequential`, recording wall time, tokens and cost for each. Run `npm run benchmark -- --only H --out benchmarks/results-<date>-parallel.json`.
- [ ] **Step 3: Add the results** to the Benchmarks page in both languages (time saved, cost unchanged, one run).
- [ ] **Step 4: Run** `npm test && npm run docs:build`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: add parallel roles measurement`.

---

## Self-Review Notes

- **Spec coverage:** Phase 3 of the spec's delivery (parallel read-only roles). Writers stay sequential; handoff and failure rules as the spec's Pipeline section.
- **Type consistency:** `Config.pipeline` (Task 1) is read by `groupSteps` (Task 2); `PlanStep.group` (Task 2) is read by `formatPlan` (Task 3).
- **Scope note:** `pipeline.maxParallel` bounds simultaneous agent calls because parallel calls spend rate-limit budget faster; it is not in the spec and defaults to 2.
