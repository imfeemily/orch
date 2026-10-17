# Testing

Run everything with `npm test` (Vitest). Automated tests **never call the real `claude` or `codex`**.

## Approach

- **Test first.** Write the failing test, watch it fail for the right reason, then implement. Bug fixes start with a test that reproduces the bug.
- **Inject, do not mock.** `runTask` takes `Deps { config, state, run, now }`. Tests pass a fake `RunFn` that returns scripted results and records the calls, a real `StateStore` on a temp directory, and a fixed `now`.
- **Real I/O where it is cheap.** Git behaviour is tested against real temp repositories; the daemon and MCP server are tested over real sockets and stdio.

## Where things are tested

| Area | Test files |
|---|---|
| Config loading and validation | `config.test.ts` |
| Routing, model/effort | `router.test.ts`, `agent-args.test.ts`, `orchestrator-model.test.ts` |
| Classification and reset time | `detector.test.ts`, `reset.test.ts` |
| Failover, cooldown, auth, abort | `orchestrator.test.ts`, `orchestrator-summary.test.ts` |
| Spawning | `runner.test.ts` with `test/helpers/fake-agent.mjs` |
| Handoff | `handoff.test.ts` |
| Output parsing, ledger, usage report | `output.test.ts`, `usage.test.ts`, `orchestrator-output.test.ts`, `usage-report.test.ts`, `render.test.ts` |
| Parallel roles: `groupSteps`, overlap, order, failure and abort in a batch | `team.test.ts` |
| Auto selection | `select-roles.test.ts`, plus `runAuto` in `team.test.ts` and auto dispatch in `daemon.test.ts` |
| Roles: planning, readiness, routing, team runner, report | `roles.test.ts`, `readiness.test.ts`, `orchestrator-role.test.ts`, `team.test.ts`, `plan-report.test.ts` |
| State | `state.test.ts` |
| Daemon and client | `daemon.test.ts` |
| CLI parsing | `args.test.ts` |
| MCP server | `mcp.test.ts` (client over stdio against an in-process daemon) |
| Generated reference | `reference.test.ts` |
| Docs stay in sync | `docs-coverage.test.ts` |

## Docs coverage tests

`docs-coverage.test.ts` fails when code and guide drift apart: every CLI command in `USAGE` must appear in `docs/guide/usage.md`, every config key and environment variable in `docs/guide/configuration.md`, and every English guide page needs a Thai counterpart. Adding a command or key without documenting it breaks `npm test`.

## Test helpers

- `test/helpers/fake-agent.mjs`: a small script with modes `ok`, `limit`, `fail`, `echo-args`, `depth`, `sleep`, used to exercise the real runner.
- `test/fixtures/`: real output captured from the CLIs (`claude -p --output-format json`, `codex exec --json`), including failure cases. Recapture them when a CLI changes its format.
- `test/helpers/config.ts`: `noSummaryConfig()` and `withSummaryConfig()` so tests control whether summary calls happen.

## Benchmarks

`npm run benchmark` (script: `scripts/benchmark.ts`) runs the **real** `claude` and `codex` (experiments A to E) in temporary repositories and records tokens, cost and correctness per run in `benchmarks/`. It spends real tokens (a few dollars), so it is not part of `npm test`. Results and method are published on the Benchmarks page of the guide; rerun it and update that page when routing, handoff or output parsing changes.

## Manual smoke test (before a release)

Use a throwaway `ORCH_HOME` and run inside a git repository.

1. `orch run "reply with exactly the word pong and nothing else"` returns `pong` from the first agent.
2. Set `agents.claude.command: /usr/bin/false`, `orch daemon stop`, run again: `switched agent, finished with codex`, and `orch status` shows claude `available` (a plain failure sets no cooldown).
3. Point `agents.claude.command` at a script that prints `usage limit reached` to stderr and exits 1: claude shows `cooling down` afterwards.
4. Register the MCP server in both tools and call `orch_run` from each.
