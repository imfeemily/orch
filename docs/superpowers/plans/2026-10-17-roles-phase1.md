# Roles, Phase 1 (core) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a task through one role, a named team or an explicit role list, with readiness checks, dry-run, artifacts and per-role usage, without changing plain `orch run`.

**Architecture:** A role is a config entry that becomes one ordinary `runTask` (so routing, failover, presets and the ledger all apply). Pure modules plan roles and build prompts; a small team runner sequences the calls and writes handoff artifacts; a readiness checker gates roles that need Codex capabilities. Daemon, CLI and MCP only pass new optional fields.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-17-roles-design.md` (Phase 1 in "Delivery"; auto, the other three roles, and parallel roles are later phases)

## Global Constraints

- Node.js >= 20; strict TypeScript; `.js` import extensions; `src/core` imports nothing from `daemon`, `cli` or `mcp`.
- Automated tests never call the real `claude` or `codex`; readiness uses an injectable command runner.
- With no role flag, behavior is identical to today (`orch run "..."`). All new config keys are optional with defaults.
- Phase 1 ships roles `developer`, `tester`, `reviewer` and teams `quick` (`developer`) and `standard` (`developer`, `tester`, `reviewer`); config validation never refers to a role that does not exist.
- Canonical order for teams: architecture, designer, developer, tester, reviewer, security (filtered to the roles that exist).
- `--role`, `--roles` and `--team` are mutually exclusive.
- Roles with `needs: [image]` are pinned to Codex and are never failed over to Claude; if Codex is not ready they are skipped (or the run stops with `--require-codex`).
- Artifacts: `.orch/runs/<run-id>/<role>.md` under the cwd, with `.orch/runs/.gitignore` containing `*`; the user's `.gitignore` is never edited; artifact write failures never fail a run.
- Handoffs: each role is asked to finish with a `## Handoff` section of at most 150 words; fallback is the last 1,500 characters; summaries passed to a role are capped at `pipeline.handoffChars` (default 4000), newest first.
- Code and docs change together (`AGENTS.md`); `docs-coverage.test.ts` must stay green in every task that adds a command, flag or config key.
- Commit prefixes: `feat:`, `fix:`, `docs:`, `test:`.

## Review Focus

1. Conflicting selectors (`--role` with `--team`, etc.), unknown role/team names: rejected with the valid names, nothing runs (Tasks 2, 5, 6).
2. A role that needs an image when Codex is not ready: skipped with the reason, never silently run on Claude, and never failed over to Claude when Codex fails (Tasks 3, 4, 5).
3. A failing role stops the pipeline and the rest are reported `not-run`; aborting cancels the remaining roles (Task 5).
4. An agent that ignores the `## Handoff` instruction, or returns a huge handoff: fallback and cap apply (Task 2).
5. A read-only or unwritable cwd for artifacts must not fail the run, and the user's `.gitignore` is untouched (Task 5).

---

### Task 1: Types and config (roles, teams, pipeline)

**Files:**
- Modify: `src/core/types.ts`, `src/core/config.ts`, `scripts/reference.ts`
- Test: `test/config.test.ts`, `test/reference.test.ts`

**Interfaces:**
- Produces in `types.ts`: `type Capability = "image"`; `interface RoleConfig { prompt: string; agent?: AgentName; model?: string; effort?: string; context?: string; needs: Capability[]; writes: boolean; agentArgs?: Partial<Record<AgentName, string[]>> }`; `Config.roles: Record<string, RoleConfig>`; `Config.teams: Record<string, string[]>`; `Config.pipeline: { handoffChars: number }`; `RoleResult`, `PlanStep` (below); `TaskResult.status` gains `"planned"`; `TaskResult.roles?: RoleResult[]`; `TaskResult.plan?: PlanStep[]`; `interface RoleResult { role: string; agent: AgentName | null; status: "ok" | "failed" | "skipped" | "not-run"; reason?: string; artifact?: string; usage?: Usage }`; `interface PlanStep { role: string; agent: AgentName | null; skipReason?: string }`; `JobEntry.role?: string`.
- Defaults in `DEFAULT_CONFIG`: roles `developer` (`writes: true`, `agentArgs.claude: ["--permission-mode", "acceptEdits"]`, `agentArgs.codex: ["-s", "workspace-write"]`), `tester` (same args, `writes: true`), `reviewer` (`context: "lean"`, `writes: false`); each with a real role `prompt` (developer: implement the task with minimal changes; tester: add or update tests only, never application code; reviewer: review the working-tree changes for bugs and risks, read-only); `needs: []`. Teams `quick: ["developer"]`, `standard: ["developer", "tester", "reviewer"]`; `pipeline.handoffChars: 4000`.

- [ ] **Step 1: Write failing tests.** `config.test.ts`: defaults contain the three roles and two teams with the values above; a user config adding `roles.mine` and overriding `roles.reviewer.model` merges by role name and by key (other defaults kept); user `teams.docs: [reviewer]` is added; rejected with the key named: role `agent: gemini`, role `context: nope`, role `needs: [video]`, role `needs: [image]` with `agent: claude`, team naming an unknown role, `pipeline.handoffChars: 0` and `"x"`. `reference.test.ts`: the generated config reference contains "Roles", each role name, and each team name.
- [ ] **Step 2: Run** `npx vitest run test/config.test.ts test/reference.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, defaults, merge (`mergeRoles` per role and per key, `teams` by name, `pipeline` shallow) and validation in `config.ts`, and a "Roles" and "Teams" section in `scripts/reference.ts` (yaml of `roles`, `teams`, `pipeline`).
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: PASS except `docs-coverage` (fixed in Task 7; add the new keys to its list in Task 7 only).
- [ ] **Step 5: Commit** `feat: add roles, teams and pipeline config`.

### Task 2: Role planning and prompts (pure)

**Files:**
- Create: `src/core/roles.ts`, `test/roles.test.ts`

**Interfaces:**
- Consumes: `Config`, `RoleConfig`.
- Produces: `CANONICAL_ORDER: string[]`; `interface RoleSelection { role?: string; roles?: string[]; team?: string }`; `planRoles(config: Config, sel: RoleSelection): { names: string[] } | { error: string }`; `interface Handoff { role: string; text: string }`; `buildRolePrompt(role: RoleConfig, task: string, handoffs: Handoff[], askHandoff: boolean): string`; `extractHandoff(output: string): string`; `capHandoffs(handoffs: Handoff[], maxChars: number): Handoff[]`.

- [ ] **Step 1: Write failing tests.** `planRoles`: `{role:"reviewer"}` gives `["reviewer"]`; `{team:"standard"}` gives developer, tester, reviewer in canonical order even if the team lists them differently; `{roles:["reviewer","developer"]}` keeps the given order and removes duplicates; none of the three gives an error "choose --role, --roles or --team"; two of them gives an error naming both; an unknown role or team gives an error listing the valid names. `buildRolePrompt`: contains the role prompt, then `## Task` and the task, then `## Earlier roles` with `### <role>` per handoff only when there are handoffs, and ends with an instruction naming `## Handoff` and 150 words only when `askHandoff`. `extractHandoff`: returns the text under the last `## Handoff` heading up to the next `## ` heading; with no such heading returns the last 1,500 characters trimmed; trims whitespace; an empty output gives `""`. `capHandoffs`: keeps newest-first within the budget, always keeps at least a truncated newest handoff, and `maxChars` 0 returns `[]`.
- [ ] **Step 2: Run** `npx vitest run test/roles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/core/roles.ts` per the signatures; error strings include the valid names.
- [ ] **Step 4: Run** `npx vitest run test/roles.test.ts && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add role planning, prompts and handoff extraction`.

### Task 3: Readiness checker

**Files:**
- Create: `src/core/readiness.ts`, `test/readiness.test.ts`

**Interfaces:**
- Consumes: `Config`, `AgentName`, `Capability`.
- Produces: `type CommandRunner = (command: string, args: string[]) => Promise<{ exitCode: number | null; stdout: string }>`; `interface Readiness { ready: boolean; reasons: string[] }`; `type ReadinessChecker = (agent: AgentName, needs?: Capability[]) => Promise<Readiness>`; `createReadinessChecker(opts: { config: Config; isCooling: (a: AgentName) => boolean; run?: CommandRunner; ttlMs?: number; now?: () => number }): ReadinessChecker`; `spawnRunner: CommandRunner` (10-second timeout, never throws).

- [ ] **Step 1: Write failing tests** with a scripted fake `CommandRunner`: Claude ready when `<cmd> --version` exits 0 and `auth status` stdout JSON has `loggedIn: true`; Claude not ready with the reasons "not installed" (version exit non-zero or null), "not logged in: run `claude`, then /login"; Codex ready when `--version` exits 0, `login status` exits 0, and (for `needs: ["image"]`) `features list` stdout has a line starting `image_generation` whose last column is `true`; reasons "not logged in: run `codex login`", "image generation is disabled in codex features"; `needs: ["image"]` on Claude is never ready ("claude cannot generate images"); a cooling agent is not ready ("cooling down"); the command used is `config.agents[agent].command`; results are cached for `ttlMs` (the runner is not called again within the ttl and is called again after it, using the injected `now`); cooldown is evaluated live, not cached.
- [ ] **Step 2: Run** `npx vitest run test/readiness.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/core/readiness.ts`; cache the install, login and capability results (not the cooldown) per agent and capability set.
- [ ] **Step 4: Run** `npx vitest run test/readiness.test.ts && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add agent readiness checks`.

### Task 4: Role support in the orchestrator

**Files:**
- Modify: `src/core/router.ts`, `src/core/agent-args.ts`, `src/core/orchestrator.ts`, `src/core/usage.ts`
- Test: `test/router.test.ts`, `test/agent-args.test.ts`, `test/orchestrator-role.test.ts` (new), `test/usage.test.ts`

**Interfaces:**
- Consumes: `RoleConfig`, `Route`, `pickRoute`.
- Produces: `pickRoleRoute(config: Config, role: RoleConfig, prompt: string, isCooling: (a: AgentName) => boolean): Route | null`; `ModelChoice.roleArgs?: string[]` (inserted after context args, before `--`); `TaskRequest.role?: string`; `TaskRequest.runId?: string` (used as the ledger `taskId` when given); `LedgerEntry.role?: string`; `summarize(entries, "role")` with label `(none)`.

- [ ] **Step 1: Write failing tests.**
  - `pickRoleRoute`: preferred agent is `role.agent`, else the agent normal routing would pick; model, effort and context come from the role; a cooling preferred agent falls back to the other agent keeping only the context; a role with `needs` never falls back (returns `null`); both cooling returns `null`.
  - `buildAgentArgs`: `roleArgs` come after context args and before `--`.
  - `orchestrator-role.test.ts` (fake `RunFn`, `Ledger`): a request with `role` uses the role's agent, model/effort flags, context preset flags and `agentArgs[agent]`; after a failover the other agent gets its own `agentArgs`, not the first agent's; a role with `needs` is not failed over after a failure (status `failed`, one call); ledger entries and job entries carry `role`; `runId` becomes the ledger `taskId`; an unknown `role` is rejected naming the valid roles; with no `role` the call is identical to today (existing tests stay green); `summarize(..., "role")` groups and labels.
- [ ] **Step 2: Run** the four test files. Expected: FAIL.
- [ ] **Step 3: Implement** the router function, the `roleArgs` insertion, and in `runTask`: resolve `req.role` first (reject unknown), route with `pickRoleRoute` when a role is set, add `roleArgs` per attempt for whichever agent runs, skip failover when the role has `needs`, and record `role` on ledger and job entries.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: PASS except `docs-coverage`.
- [ ] **Step 5: Commit** `feat: route a task through a role in the orchestrator`.

### Task 5: Team runner

**Files:**
- Create: `src/core/team.ts`, `test/team.test.ts`

**Interfaces:**
- Consumes: `planRoles`, `buildRolePrompt`, `extractHandoff`, `capHandoffs`, `runTask`, `ReadinessChecker`, `Deps`.
- Produces: `interface TeamDeps extends Deps { readiness: ReadinessChecker }`; `interface TeamRequest extends RoleSelection { task: string; cwd: string; depth: number; context?: string; signal?: AbortSignal; onChunk?: (t: string) => void; dryRun?: boolean; requireCodex?: boolean; keepGoing?: boolean }`; `runRoles(deps: TeamDeps, req: TeamRequest): Promise<TaskResult>`.

- [ ] **Step 1: Write failing tests** (fake `RunFn` returning scripted outputs, fake readiness, temp cwd):
  - Single role: returns the `runTask` result with the role applied, streams chunks for text agents, writes no artifacts.
  - Team `standard`: three calls in order developer, tester, reviewer; the tester's prompt contains the developer's handoff and the reviewer's contains both; `result.roles` lists three `ok` entries with artifact paths; each artifact file exists under `.orch/runs/<id>/` with the full output and `.orch/runs/.gitignore` is `*`; the user's `.gitignore` is untouched; all ledger entries share one `taskId`.
  - Output with no `## Handoff` heading passes its last 1,500 characters; handoffs over `pipeline.handoffChars` are capped before reaching the next role.
  - A failing role stops the pipeline: later roles are `not-run`, status `failed`; with `keepGoing` the remaining roles run.
  - Abort via `signal` after the first role cancels the rest (`not-run`).
  - `dryRun` returns status `planned`, a `plan` with the agent for each role and the call count in `message`, makes zero `RunFn` calls and zero artifacts; a role whose readiness fails shows `skipReason` in the plan.
  - A role with `needs: ["image"]` and a not-ready Codex is `skipped` with the reasons, the run continues and the overall status stays `ok`; with `requireCodex` nothing runs and the status is `failed` with the reasons; `requireCodex` is ignored when no role needs an image.
  - An unwritable cwd for artifacts does not fail the run (`artifact` undefined).
  - Conflicting selectors and unknown names return status `rejected` with the planner's message.
- [ ] **Step 2: Run** `npx vitest run test/team.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `runRoles`: plan with `planRoles`; dry-run path; readiness gate for roles with `needs` (agent `role.agent ?? "codex"`); sequential `runTask` per role with `role`, shared `runId`, built prompt, and `context` passed through; artifact writing and handoff extraction; failure, `keepGoing` and abort handling; aggregate `output` as `## <role>` sections of each role's answer and `usage` as the sum.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: PASS except `docs-coverage`.
- [ ] **Step 5: Commit** `feat: add the team runner with artifacts and readiness gating`.

### Task 6: Daemon, CLI and MCP wiring

**Files:**
- Modify: `src/daemon/protocol.ts`, `src/daemon/server.ts`, `src/daemon/index.ts`, `src/cli/args.ts`, `src/cli/usage.ts`, `src/cli/index.ts`, `src/mcp/index.ts`
- Create: `src/cli/plan-report.ts`; Test: `test/plan-report.test.ts`, `test/args.test.ts`, `test/daemon.test.ts`, `test/mcp.test.ts`

**Interfaces:**
- Produces: the `run` request gains `role?: string; roles?: string[]; team?: string; dryRun?: boolean; requireCodex?: boolean; keepGoing?: boolean`; `Command.run` gains the same fields; `usage --by role`; `formatPlan(result: TaskResult): string` and `formatRoles(result: TaskResult): string` in `plan-report.ts`.

- [ ] **Step 1: Write failing tests.** `args.test.ts`: `--role reviewer`, `--roles developer,tester` (split on commas), `--team standard`, `--dry-run`, `--require-codex`, `--keep-going` parse; `--role` without a value, and combining `--role` with `--team`, throw naming the flags; `usage --by role` parses. `plan-report.test.ts`: `formatPlan` lists each role with its agent, shows `skip: <reason>` for skipped steps and the model-call count; `formatRoles` lists each role with `ok`, `failed`, `skipped`, `not-run` and the reason. `daemon.test.ts`: a run request with `team: "standard"` reaches the team runner (three fake calls in order) and a request with `dryRun` returns `planned` without calls; plain run unchanged. `mcp.test.ts`: `orch_run` with `role` reaches the daemon and the footer lists the role statuses for a team.
- [ ] **Step 2: Run** the new and changed test files. Expected: FAIL.
- [ ] **Step 3: Implement.** Server: when any role field is present call `runRoles` (passing `signal` and `onChunk`), otherwise `runTask`; the daemon builds the real readiness checker with `spawnRunner` and the state's `isCooling`. CLI: new flags, `USAGE` lines (`orch run [--role NAME | --team NAME | --roles A,B] [--dry-run] [--require-codex] [--keep-going] ...`), print `formatPlan` for a planned result and `formatRoles` on stderr after a team run (exit non-zero when status is `failed` or `rejected`), status shows `{role}`. MCP: optional `role`, `roles`, `team`, `dryRun`, `requireCodex`, `keepGoing` parameters passed through, footer includes the role statuses.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: PASS except `docs-coverage`.
- [ ] **Step 5: Commit** `feat: expose roles through the daemon, CLI and MCP`.

### Task 7: Documentation

**Files:**
- Create: `docs/guide/roles.md`, `docs/th/guide/roles.md`
- Modify: `docs/guide/usage.md`, `docs/guide/configuration.md`, `docs/guide/troubleshooting.md`, the three Thai twins, `docs/.vitepress/config.ts`, `docs/developer/architecture.md`, `docs/developer/testing.md`, `README.md`, `CHANGELOG.md`, `test/docs-coverage.test.ts`

- [ ] **Step 1: Extend `docs-coverage.test.ts`:** the config key list gains `roles`, `teams`, `pipeline`, `handoffChars`, `prompt`, `needs`, `writes`, `agentArgs`; usage must contain `--role`, `--roles`, `--team`, `--dry-run`, `--require-codex`, `--keep-going`. Run it: FAIL.
- [ ] **Step 2: Write the docs** (English and Thai): the Roles page (modes, built-in roles and teams, pipeline and artifacts, handoff, readiness and the Codex gate, dry-run, cost warning that several roles cost several calls, the write-permission warning for `developer` and `tester`, examples), configuration keys, usage flags and `usage --by role`, troubleshooting rows (role skipped because Codex is not ready, unknown role or team, a role stopped the pipeline), architecture (new modules and flow), testing, README bullet, sidebar entries, `CHANGELOG.md` under Unreleased.
- [ ] **Step 3: Run** `npm test && npm run docs:build`. Expected: all PASS, no dead links.
- [ ] **Step 4: Commit** `docs: document roles`.

### Task 8: Real-CLI verification and measured cost

**Files:**
- Modify: `scripts/benchmark.ts`, `docs/guide/benchmarks.md`, `docs/th/guide/benchmarks.md`
- Create: `benchmarks/results-<date>-roles.json` (generated)

- [ ] **Step 1: Smoke test with a throwaway `ORCH_HOME` inside a git repository** (build first): `orch run --role reviewer --dry-run "review"` prints the plan with no model call; `orch run --role reviewer "review the last commit"` returns a review; `orch run --team standard --dry-run "add a clamp test"` lists three roles and three calls; `orch run --team standard "add a test for clamp() in src/math.ts"` on a seeded repository writes three artifacts, a test file exists, and `orch usage --by role` shows three rows; simulate Codex not ready (`agents.codex.command` pointing at a missing binary) with a team whose config gives a role `needs: [image]` and see it skipped with the reason.
- [ ] **Step 2: Add experiment F** to `scripts/benchmark.ts`: the "write a small test" task as one plain call against `--team standard`, recording tokens and cost per role, and whether the final result is correct. Run `npm run benchmark -- --only F --out benchmarks/results-<date>-roles.json`.
- [ ] **Step 3: Add the results** to the Benchmarks page in both languages, stating the cost multiple honestly (several roles cost several calls; the benefit is review and tests, not savings) and the limits (one task, one run).
- [ ] **Step 4: Run** `npm test && npm run docs:build`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: add roles benchmark results`.

---

## Self-Review Notes

- **Spec coverage (Phase 1):** invocation modes except auto (T2, T4, T5, T6), config and validation (T1), pipeline, artifacts, handoff, failure and abort (T2, T5), readiness and the Codex gate (T3, T4, T5), dry-run (T5, T6), ledger and `usage --by role` (T4, T6), docs and measured cost (T7, T8). Auto, `architecture`, `designer`, `security` and parallel roles are Phases 2 and 3.
- **Type consistency:** `RoleConfig`, `RoleResult`, `PlanStep` (T1) are used unchanged in T2 to T6; `Route` gains nothing new (role args are applied per attempt in `runTask`); `ReadinessChecker` (T3) is consumed by T5 and T6.
- **Known gap by design:** no role in Phase 1 has `needs: ["image"]` by default; its handling is tested with custom config so Phase 2 only adds roles.
