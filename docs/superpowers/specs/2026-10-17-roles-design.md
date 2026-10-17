# Roles: single role, teams and auto selection

Date: 2026-10-17
Status: Draft for review
Builds on: `2026-10-15-orch-design.md`, `2026-10-17-model-control-design.md` (context presets already shipped)

## Goal

Let a task be handled by role agents (architecture, developer, designer UX/UI, tester, reviewer, security) instead of
one general call, while keeping orch what it is: a small local router that picks an agent, fails over on limits, and
measures tokens. Work that creates images or diagrams goes to Codex, and only after orch has confirmed Codex is ready.

## Success criteria

- `orch run "..."` behaves exactly as before: no role flag, no `auto` setting, no change.
- `orch run --role reviewer "..."` runs one role through the normal route, failover and ledger.
- `orch run --team standard "..."` and `--roles a,b,c` run a pipeline and report each role's outcome.
- `orch run --auto "..."` chooses roles deterministically, shows why, and never calls a model to decide.
- `--dry-run` prints the plan and the number of model calls without spending tokens.
- A role that needs image generation runs only when Codex is installed, logged in, has image generation enabled and is not
  cooling down; otherwise it is skipped with a clear reason (or the run stops with `--require-codex`).
- Every role call appears in the ledger with its role, so `orch usage --by role` shows what each role cost.

## Out of scope

- Roles defined by the model itself (a lead agent that plans); roles are config entries.
- Isolated git worktrees for parallel writers. Only read-only roles ever run in parallel.
- Interactive approval prompts between roles.
- Choosing roles with an LLM, and learning from outcomes.

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Shape | A role is a config entry that becomes one ordinary `runTask`; no new engine |
| Invocation | None (unchanged), single role, team or explicit list, auto; opt-in everywhere |
| Pipeline | Fixed order, sequential for anything that writes; read-only roles may run in parallel (phase 3) |
| Handoff | Each role leaves a short summary file; the next roles receive only summaries, within a size budget |
| Images and diagrams | Roles that need them are pinned to Codex behind a readiness check |
| Auto | Keyword and signal rules, capped (`auto.maxRoles`, default 3), explainable |
| Cost stance | More roles cost more than one call; roles are opt-in and default to the lean context |

Changed from the discussion: built-in roles set `context: lean` but **no model**. Reviewing and security need judgement, and a
smaller model is a quality choice the user should make from the benchmarks, not a default.

## Invocation modes

| Mode | Flags | Notes |
|---|---|---|
| Plain | none | Unchanged. Used when `auto` is not enabled |
| Single role | `--role NAME` | One run with that role's prompt, agent, model, effort and context. Output printed as usual |
| Team | `--team NAME` | Roles of a named team, in canonical order |
| Explicit list | `--roles a,b,c` | Roles in the order given |
| Auto | `--auto`, or `auto.enabled: true` in config | Roles chosen from the prompt; `--no-auto` turns a config default off |

Other flags: `--dry-run`, `--require-codex`, `--keep-going`. `--role`, `--team`, `--roles` and `--auto` are mutually
exclusive (an error names the conflict). The same fields exist on the daemon `run` request and as optional parameters on MCP
`orch_run` (`role`, `roles`, `team`, `auto`, `dryRun`, `requireCodex`, `keepGoing`). Precedence when several sources apply:
explicit flags, then `auto.enabled`, then plain.

## Configuration

```yaml
roles:
  reviewer:
    prompt: "You are a code reviewer. ..."   # built-in default exists; override to taste
    agent: claude          # optional; otherwise normal routing
    model: haiku           # optional
    effort: low            # optional
    context: lean          # a context preset name
    needs: []              # capabilities: image
    writes: false          # may it change project files
    agentArgs:             # extra flags per agent, e.g. permissions for roles that write
      claude: ["--permission-mode", "acceptEdits"]
teams:
  quick: [developer]
  standard: [developer, tester, reviewer]
  full: [architecture, designer, developer, tester, reviewer, security]
auto:
  enabled: false
  maxRoles: 3
pipeline:
  handoffChars: 4000       # budget for the summaries passed to a role
```

Built-in roles (all editable): `architecture`, `designer` (`needs: [image]`, agent `codex`), `developer` (`writes: true`),
`tester` (`writes: true`, test files only by instruction), `reviewer`, `security`. Read-only roles default to
`context: lean`. Roles with `writes: true` get the agent's permission flags through `agentArgs`, because headless agents cannot
edit files otherwise; the documentation says plainly that using a writing role lets the agent edit the project.

Validation at load: unknown `context`, unknown capability in `needs`, a team naming an unknown role, an `agent` that is not
`claude` or `codex`, and a `needs: [image]` role pinned to `claude` are all rejected with the key named.

## Pipeline

- **Canonical order:** architecture, designer, developer, tester, reviewer, security. A team or auto selection runs its roles
  in this order; `--roles` keeps the order the user gave.
- Each role is one `runTask` with a prompt built from the role prompt, the original task, and the summaries of earlier
  roles. The role is asked to finish with a `## Handoff` section of at most 150 words; orch saves the full answer to
  `.orch/runs/<run-id>/<role>.md` and keeps the handoff text (fallback: the last 1,500 characters) for later roles.
- Summaries passed to a role are capped by `pipeline.handoffChars` (default 4,000) in total, newest first.
- `.orch/runs/` is created with its own `.gitignore` containing `*`; the user's `.gitignore` is never edited. Image and diagram
  files a role creates are saved under `.orch/runs/<run-id>/assets/`.
- Writers (`writes: true`) run one at a time. Phase 3 lets adjacent read-only roles (reviewer and security) run in parallel.
- **Failure:** a role that fails after failover stops the pipeline and the result lists finished, failed and not-run roles.
  `--keep-going` continues with the remaining roles. A skipped role (readiness) is not a failure.
- **Cancellation:** closing the connection aborts the running role and cancels the rest.

## Readiness and the Codex gate

`checkAgentReady(agent)` returns `{ ready, reasons[] }` using only free commands, cached for 60 seconds per daemon:

| Check | Claude | Codex |
|---|---|---|
| Installed | `claude --version` exits 0 | `codex --version` exits 0 |
| Logged in | `claude auth status` reports `loggedIn: true` | `codex login status` exits 0 |
| Capability `image` | not supported | `codex features list` shows `image_generation` enabled |
| Not cooling down | orch state | orch state |

A role with `needs: [image]` is pinned to Codex. If Codex is not ready its role is **skipped** with the reasons (for example
"not logged in: run `codex login`"), and the final result says which artifacts were not produced. With `--require-codex` the
run stops before any role starts. `--dry-run` runs the readiness checks too, so the plan shows what would be skipped.
Text diagrams (Mermaid) written by the architecture role do not need Codex and are not affected.

## Auto selection

`selectRoles(prompt, signals)` is a pure function returning `{ roles, reasons }`, with no model call.

- A question or explanation with no change intent (explain, what, where, why, how does) selects **no roles**: it runs as a plain
  call, the cheapest path.
- Otherwise `developer` is always chosen, plus any of these when their words appear in the prompt (word lists are defaults in
  code and extended under `auto.keywords`, which adds to the built-in words):
  - `tester`: test, bug, fix, regression, feature, implement
  - `reviewer`: refactor, migrate, implement, feature (also when the prompt is long)
  - `security`: auth, login, token, password, secret, crypto, sql, upload, permission, payment
  - `architecture`: architecture, design the, module, boundary, api design, migrate
  - `designer`: ui, ux, screen, layout, mockup, wireframe, diagram, image, logo
- If more than `auto.maxRoles` match, keep the highest-priority ones: developer, then security, tester, reviewer,
  architecture, designer. The dropped roles are listed in the reasons.
- `orch explain "<prompt>"` prints the selection and reasons without running anything. A normal auto run prints `auto: roles developer, tester, reviewer` and the reasons on stderr.

## Data model and interfaces

New pure modules in `src/core`: `roles.ts` (resolve a role, build its prompt, team and order), `select-roles.ts`
(`selectRoles`), `readiness.ts` (`checkAgentReady`, with an injectable command runner), `team.ts` (`runTeam`: runs the plan
through `runTask`, handles artifacts, handoffs and failure rules). Changes elsewhere: `config.ts` (keys, defaults,
validation), `orchestrator.ts` (`TaskRequest.role`, ledger and job `role`, per-role `agentArgs`), `daemon` protocol and server
(new request fields), CLI (`--role`, `--team`, `--roles`, `--auto`, `--dry-run`, `--require-codex`, `--keep-going`, `explain`,
`usage --by role`), MCP (parameters), `usage.ts` (`role` and `runId` on ledger entries, `summarize` by role).
`TaskResult` gains `roles?: RoleResult[]` where `RoleResult = { role, agent, status: "ok" | "failed" | "skipped" | "not-run",
reason?, artifact?, usage? }`, and a dry run returns the plan instead of running.

## Compatibility and errors

- No role flag and `auto.enabled` false (the default) is byte-for-byte today's behavior.
- Unknown role, team or capability: rejected with the valid names; conflicting flags: rejected naming both.
- A role whose `context` preset has no entry for the chosen agent runs with that agent's normal flags.
- A failover inside a role keeps the role's context name and drops its model (model names are not portable), as for rules.

## Testing

- Fake `RunFn` and a fake command runner for readiness: ready, not installed, not logged in, feature off, cooling down.
- Pipeline tests: order, summaries passed and capped, artifacts written, failure stops, `--keep-going`, skipped is not failed,
  abort cancels the rest, writers never overlap.
- Auto: a table of prompts to expected roles and reasons, the cap and priority, question gives no roles.
- Config validation for each new key; docs-coverage extended to the new keys, flags and commands.
- Real-CLI checks per phase: one single-role call, one team run, the Codex gate with Codex ready and with it disabled, and a
  measured cost comparison (single call against `standard` team) on the benchmark tasks, published on the Benchmarks page.

## Delivery (each phase ships on its own)

1. Core: role and team config, single role, explicit team/list, `--dry-run`, readiness, ledger and `usage --by role`; built-in
   `developer`, `tester`, `reviewer`.
2. Remaining roles (`architecture`, `designer`, `security`), Codex image and diagram flow with the gate, and auto selection
   with `orch explain`.
3. Parallel read-only roles.

Roles, teams and config keys ship with the phase that implements them: phase 1 defines only its three roles and the `quick` and
`standard` teams, and the `full` team and the other roles appear in phase 2, so config validation never refers to a role that does not exist yet.

## Risks and open items for planning

- Headless image generation through `codex exec` is unverified: where the files land, what sandbox flags it needs, and how
  it reports them. Phase 2 starts with a spike that settles this before any design depends on it.
- The handoff section depends on the model following instructions; the fallback (last 1,500 characters) covers misses.
- Multi-role runs spend several times the tokens of one call. The benchmark in each phase reports the real multiple.
- Permission flags for writing roles widen what the agent may do; defaults are explicit and documented, never silent.
