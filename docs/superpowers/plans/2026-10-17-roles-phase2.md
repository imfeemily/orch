# Roles, Phase 2 (more roles, Codex images, auto) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the architecture, designer and security roles and the `full` team, a Codex image flow with asset files, and automatic role selection with `orch explain`; also close the cheap config-validation minors from the Phase 1 review.

**Architecture:** Extends Phase 1 without new engines. Roles stay config entries run through `runTask`. A pure `selectRoles` picks roles from the prompt; `runAuto` applies it and falls through to a plain call when nothing is selected. Image roles get an assets directory and are reported by listing the files they leave there, because the spike showed Codex writes ordinary files and emits no image event.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-17-roles-design.md` (Phase 2 in "Delivery") and `docs/superpowers/plans/2026-10-17-roles-phase1.md` for the shared interfaces.

## Spike findings (2026-10-17, settled before this plan)

- Headless `codex exec -s workspace-write` can create an image: it produced a valid 512x512 PNG at the requested relative path and replied with the path. It read its `imagegen` skill, then drew with Pillow. Events are ordinary `command_execution` items plus the final `agent_message`; there is no image event.
- Without `-s workspace-write` Codex cannot write the file. The built-in designer role carries that flag in `agentArgs`.
- If stdin is left open Codex waits on "Reading additional input from stdin..."; orch spawns agents with stdin ignored, so it is unaffected.
- Cost is high: about 121,000 input tokens (103,000 cached) for one small logo.

## Global Constraints

- Node.js >= 20; strict TypeScript; `.js` import extensions; `src/core` imports nothing from `daemon`, `cli` or `mcp`.
- Automated tests never call the real `claude` or `codex`.
- Plain `orch run` is unchanged unless `auto.enabled` is true or a role/auto flag is given; `auto.enabled` defaults to false.
- Precedence: `--role`/`--roles`/`--team` (mutually exclusive) beat `--auto`, which beats `auto.enabled`, which beats plain; `--no-auto` turns `auto.enabled` off for one run; `--role`/`--roles`/`--team` combined with `--auto` is an error naming both.
- Auto selection never calls a model; default `auto.maxRoles` is 3; priority when capped: developer, security, tester, reviewer, architecture, designer; selected roles run in canonical order (architecture, designer, developer, tester, reviewer, security).
- A question or explanation prompt with no change intent selects no roles and runs as a plain call.
- Roles that need `image` are pinned to Codex, are skipped (not failed) when Codex is not ready, and never fail over to Claude.
- A context preset that disables `image_generation` for codex makes an image role not ready.
- Role names must match `/^[a-z0-9_-]+$/i`; teams must not be empty; role entries must be mappings.
- Code and docs change together (`AGENTS.md`); `docs-coverage.test.ts` stays green in every task that adds a flag, command or config key.
- Commit prefixes: `feat:`, `fix:`, `docs:`, `test:`.

## Review Focus

1. Auto must not turn a question into a pipeline and must respect the cap; the dropped roles are reported, not silently lost (Tasks 2, 4).
2. A designer role with Codex missing, not logged in, or `image_generation` disabled (directly or by a context preset) is skipped with the reason and never runs on Claude (Tasks 3, 4).
3. Images are reported from files that exist in the assets directory, not from model text; a role that leaves no file is reported as such, and the directory is created by orch, not left to the model (Task 3).
4. `--auto` with an explicit selector, `--no-auto` without `auto.enabled`, and role-only flags with neither are handled with clear errors (Task 4).
5. Config: invalid role names (path traversal), empty teams, non-mapping roles, a bad `auto` block all fail at load naming the key (Task 1).

---

### Task 1: Config: new roles, teams, `auto`, and stricter validation

**Files:**
- Modify: `src/core/types.ts`, `src/core/config.ts`, `scripts/reference.ts`
- Test: `test/config.test.ts`, `test/reference.test.ts`

**Interfaces:**
- Produces in `types.ts`: `interface AutoConfig { enabled: boolean; maxRoles: number; keywords?: Record<string, string[]> }`; `Config.auto: AutoConfig`.
- Defaults added: roles `architecture` (read-only, `context: "lean"`, prompt: analyse the task and the repository, describe the design, module boundaries and risks, include a Mermaid diagram in a fenced block when it helps, change no files), `designer` (`needs: ["image"]`, `agent: "codex"`, `writes: false`, `agentArgs.codex: ["-s", "workspace-write"]`, prompt: UX/UI designer, create mockup or diagram images for the task, save image files only into the assets directory given in the prompt, change no project files, reply with the file paths and a short description), `security` (read-only, `context: "lean"`, prompt: review the working-tree changes for security problems such as injection, authorization, secrets, unsafe dependencies and data exposure, most serious first, change no files); team `full: ["architecture", "designer", "developer", "tester", "reviewer", "security"]`; `auto: { enabled: false, maxRoles: 3 }`.

- [ ] **Step 1: Write failing tests.** `config.test.ts`: defaults contain the six roles and teams `quick`, `standard`, `full` (full lists the six); `designer` has `needs` `["image"]`, `agent` `codex`, and the codex `-s workspace-write` arg; `auto` defaults; user `auto: { enabled: true, maxRoles: 2, keywords: { security: ["pii"] } }` merges; rejected naming the key: a role named `../x` and one named `a/b` (`roles`), `teams: { t: [] }`, a role entry that is a string (`roles.reviewer`), `auto.enabled: "yes"`, `auto.maxRoles: 0`, `auto.keywords` naming an unknown role, `auto.keywords.security` not a list of strings. `reference.test.ts`: the reference lists `auto` and the role names `architecture`, `designer`, `security`.
- [ ] **Step 2: Run** `npx vitest run test/config.test.ts test/reference.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the defaults, `auto` merge (shallow, `keywords` per role) and the validations in `config.ts`; add `auto` to the roles section of `scripts/reference.ts`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: PASS except `docs-coverage`.
- [ ] **Step 5: Commit** `feat: add architecture, designer and security roles, auto config and stricter role validation`.

### Task 2: Auto selection (pure)

**Files:**
- Create: `src/core/select-roles.ts`, `test/select-roles.test.ts`

**Interfaces:**
- Consumes: `Config`, `CANONICAL_ORDER` from `roles.ts`.
- Produces: `interface Selection { roles: string[]; reasons: string[]; dropped: string[] }`; `selectRoles(config: Config, prompt: string): Selection`.

- [ ] **Step 1: Write failing tests** (a table of prompts to expected roles): "explain how the router picks an agent" gives no roles with a reason naming the question; "what does clamp do" gives none; "fix the typo in README" gives `developer` and `tester` (word `fix`); "implement login with a password reset token" gives `developer` first by priority, then `security` and `tester`, capped at 3 with `reviewer` listed in `dropped`; "design the module boundaries for the payment api and add a login ui screen" with `maxRoles: 6` selects developer, security, architecture, designer, tester in canonical order architecture, designer, developer, tester, security; a prompt longer than 400 characters adds `reviewer`; matching is by whole word, case-insensitive ("contest" does not match `test`); multi-word keywords match as phrases; `auto.keywords.security: ["pii"]` extends the default list; a role missing from `config.roles` is never selected; every reason names the role and the word that matched; the order of `roles` is canonical.
- [ ] **Step 2: Run** `npx vitest run test/select-roles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `selectRoles`: detect a question (starts with explain, what, where, why, how does, how do, describe, summarize, list, show me) with no change verb (add, fix, implement, create, write, change, update, remove, refactor, migrate, build, make) and return no roles; otherwise `developer` plus roles whose default or configured keywords match (tester: test, bug, fix, regression, feature, implement; reviewer: refactor, migrate, implement, feature, or prompt over 400 characters; security: auth, login, token, password, secret, crypto, sql, upload, permission, payment; architecture: architecture, "design the", module, boundary, "api design", migrate; designer: ui, ux, screen, layout, mockup, wireframe, diagram, image, logo); cap by priority developer, security, tester, reviewer, architecture, designer; return roles in canonical order and the cut ones in `dropped`.
- [ ] **Step 4: Run** `npx vitest run test/select-roles.test.ts && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add automatic role selection`.

### Task 3: Assets directory, image reporting and readiness with context presets

**Files:**
- Modify: `src/core/roles.ts`, `src/core/readiness.ts`, `src/core/team.ts`, `src/core/types.ts`
- Test: `test/roles.test.ts`, `test/readiness.test.ts`, `test/team.test.ts`

**Interfaces:**
- Produces: `buildRolePrompt(role, task, handoffs, askHandoff, assetsDir?: string)`: when `assetsDir` is given the prompt ends with a `## Assets directory` section naming it (relative to the project) and telling the role to save image and diagram files there; `RoleResult.assets?: string[]` (absolute paths of files found); `contextBlocks(args: string[] | undefined, needs: Capability[]): string | undefined` in `readiness.ts` returning `context preset disables image generation` when `needs` includes `image` and `args` contains `--disable` immediately followed by `image_generation`.

- [ ] **Step 1: Write failing tests.** `roles.test.ts`: `buildRolePrompt` with `assetsDir` ends with the section and names the path; without it nothing is added. `readiness.test.ts`: `contextBlocks` returns the reason for `["--disable","image_generation"]` with `["image"]`, `undefined` without the capability, `undefined` for other `--disable` values and for `undefined` args. `team.test.ts`: a role with `needs: ["image"]` gets its prompt with the assets path `.orch/runs/<run-id>/assets` and orch creates that directory before running it; files the (fake) agent writes there appear in `result.roles[i].assets`, files are not invented from model text, and a role that leaves none reports `assets: []`; for a single image role the same directory and prompt apply; with `--context minimal` (which disables `image_generation` for codex) an image role is skipped with the preset reason, in plan and again at run time; a non-image role gets no assets section.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** In `team.ts`: compute the effective context name (`req.context ?? role.context`), call `contextBlocks` with that preset's args for the role's agent in both the plan-time and the run-time readiness steps, create the assets directory (swallowing errors) for roles that need a capability, pass `assetsDir` to `buildRolePrompt`, and after the role list the files (non-recursive, no dotfiles) in the directory into `RoleResult.assets`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: PASS except `docs-coverage`.
- [ ] **Step 5: Commit** `feat: give image roles an assets directory and report the files they create`.

### Task 4: Auto in the runner, daemon, CLI and MCP; `orch explain`

**Files:**
- Modify: `src/core/team.ts`, `src/daemon/protocol.ts`, `src/daemon/server.ts`, `src/cli/args.ts`, `src/cli/usage.ts`, `src/cli/index.ts`, `src/cli/plan-report.ts`, `src/mcp/index.ts`, `src/core/types.ts`
- Test: `test/team.test.ts`, `test/args.test.ts`, `test/plan-report.test.ts`, `test/daemon.test.ts`, `test/mcp.test.ts`

**Interfaces:**
- Produces: `TeamRequest.auto?: boolean`; `TaskResult.selection?: { roles: string[]; reasons: string[]; dropped: string[] }`; `runAuto(deps: TeamDeps, req: TeamRequest): Promise<TaskResult>` in `team.ts`; `Command` gains `{ name: "explain"; prompt: string }` and `run.auto?: boolean`, `run.noAuto?: boolean`; `formatSelection(sel): string` and `formatAssets(result): string` in `plan-report.ts`; the daemon `run` request gains `auto?: boolean`; MCP `orch_run` gains `auto`.

- [ ] **Step 1: Write failing tests.** `team.test.ts`: `runAuto` with a change prompt selects roles, runs them like a team and returns `selection`; with a question prompt runs one plain `runTask` and `selection.roles` is `[]`; `auto` plus an explicit selector is `rejected` naming both; role-only flags are allowed when `auto` is true; `dryRun` with `auto` returns the plan of the selected roles and the `selection`; `maxRoles` from config is respected. `args.test.ts`: `--auto`, `--no-auto`, `explain "prompt words"` parse; `--auto` with `--team` throws naming both; `--auto` with `--no-auto` throws. `plan-report.test.ts`: `formatSelection` prints `roles developer, tester (auto)` plus the reasons and any dropped roles, and a no-roles line for a question; `formatAssets` lists image files per role and is empty when there are none. `daemon.test.ts`: a request with `auto: true` selects and runs; with `auto.enabled` in config and no flags a change prompt runs the selected roles, a question runs plain, and `auto: false` forces plain; plain behavior is unchanged when `auto.enabled` is false.
- [ ] **Step 2: Run** the test files. Expected: FAIL.
- [ ] **Step 3: Implement.** `runAuto` calls `selectRoles`, then `runRoles` with `roles` or `runTask`, attaching `selection`. The server dispatches to `runAuto` when no explicit selector is present and (`req.auto === true` or (`req.auto !== false` and `config.auto.enabled`)); an explicit selector with `auto: true` is rejected; role-only flags without a selector are still rejected unless auto is active. CLI: `--auto`, `--no-auto`, `explain` (loads the config and prints `formatSelection` without contacting the daemon), print `formatSelection` and `formatAssets` to stderr after a run, `USAGE` lines. MCP: `auto` parameter and the selection and assets in the footer.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npm run build`. Expected: PASS except `docs-coverage`.
- [ ] **Step 5: Commit** `feat: automatic role selection in the runner, daemon, CLI and MCP`.

### Task 5: Documentation

**Files:**
- Modify: `docs/guide/roles.md`, `docs/th/guide/roles.md`, `docs/guide/usage.md`, `docs/guide/configuration.md`, `docs/guide/troubleshooting.md`, the three Thai twins, `docs/developer/architecture.md`, `docs/developer/testing.md`, `README.md`, `CHANGELOG.md`, `test/docs-coverage.test.ts`

- [ ] **Step 1: Extend `docs-coverage.test.ts`:** config keys gain `auto`, `enabled`, `maxRoles`, `keywords`; usage must contain `--auto`, `--no-auto` and `orch explain`. Run it: FAIL.
- [ ] **Step 2: Write the docs** (English and Thai): the Roles page now lists all six roles and the `full` team, the designer and the assets directory (what it saves, the cost warning from the spike, that results are reported from files), auto selection (rules, cap, `orch explain`, the one-line report, how a question stays a plain call), and the updated status note; configuration keys for `auto`; usage for `--auto`, `--no-auto`, `explain`; troubleshooting rows (role skipped by a context preset, auto picked fewer roles than expected, designer left no files); architecture and testing; README bullet; `CHANGELOG.md`.
- [ ] **Step 3: Run** `npm test && npm run docs:build`. Expected: all PASS, no dead links.
- [ ] **Step 4: Commit** `docs: document the new roles, assets and auto selection`.

### Task 6: Real-CLI verification and measured results

**Files:**
- Modify: `scripts/benchmark.ts`, `docs/guide/benchmarks.md`, `docs/th/guide/benchmarks.md`
- Create: `benchmarks/results-<date>-roles2.json` (generated)

- [ ] **Step 1: Free checks** with a throwaway `ORCH_HOME`: `orch explain` on a question, a small fix, a login-and-ui change; `orch run --auto --dry-run` on the same prompts; `orch run --role designer --dry-run`; with Codex disabled by config the designer is skipped with the reason; `--role designer --context minimal --dry-run` shows the preset reason; `--auto` with `--team` is rejected.
- [ ] **Step 2: Real runs** (spends Codex quota and some dollars): `orch run --role designer "<a small screen>"` in a seeded repository leaves at least one image file under `.orch/runs/<id>/assets/` and the CLI lists it; one `orch run --auto` on a small change, confirming the selection line and that the roles ran.
- [ ] **Step 3: Add experiment G** to `scripts/benchmark.ts` (designer role: tokens, duration, files produced) and run `npm run benchmark -- --only G --out benchmarks/results-<date>-roles2.json`; add the results to the Benchmarks page in both languages with the honest cost and the limit (one run).
- [ ] **Step 4: Run** `npm test && npm run docs:build`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: add image role and auto selection results`.

---

## Self-Review Notes

- **Spec coverage (Phase 2):** remaining roles and `full` team (T1), Codex image flow and gate with the spike's findings (T3), `auto` and `orch explain` (T2, T4), docs and measured cost (T5, T6). Parallel read-only roles are Phase 3. Minors M1-M3 are in T1; M8 is in T3.
- **Type consistency:** `AutoConfig` (T1) feeds `selectRoles` (T2) and `runAuto` (T4); `RoleResult.assets` (T3) is read by `formatAssets` (T4); `Selection` (T2) becomes `TaskResult.selection` (T4).
- **Open by design:** whether a designer slot should count against `maxRoles` when Codex is not ready is left as is (the slot is spent); the docs say so.
