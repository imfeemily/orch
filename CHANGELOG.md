# Changelog

All notable changes are listed here. Add user-visible changes under **Unreleased** in the same pull request that makes them.

## Unreleased

- Single-agent mode: `orch run --only claude|codex` (also `only` on MCP `orch_run`) runs one agent and picks its model, effort and context from a small, medium or large tier chosen by keywords (no model call). New `tiers` config with built-in defaults (Claude: haiku, sonnet, opus; Codex: effort only). No failover. `orch explain --only claude "<prompt>"` shows the tier and settings. Tiers carry `write: true` by default (the agent's new `writeArgs`: Claude `--permission-mode acceptEdits`, Codex `-s workspace-write`) so `--only` runs can edit files; `write: false` makes a tier read-only. Plain `orch run` is unchanged.

- Fixes from the reviews of earlier phases: multi-byte (Thai) text is no longer split across stream chunks; stopping a daemon cannot delete a newer daemon's socket and two daemons cannot start at once; state and ledger files are owner-only; a failing state write no longer fails the task; `timeoutSec` per agent; `orch usage` `tasks` counts distinct tasks and `tokens` sums every attempt; the ledger is trimmed every day, not only at start.
- Roles: handoff notes are marked as information, duplicate team members are removed, `--` ends options, an unknown `--context` is rejected up front, `.orch/runs/.gitignore` is written first, empty answers write no artifact, a role that throws fails only itself, and sequential runs keep plan order.
- Image roles: each role gets its own assets folder (`.orch/runs/<run-id>/assets/<role>/`), only regular files are listed, and `--disable=image_generation` or `-c features.image_generation=false` in the preset, the role's `agentArgs` or the agent's `args` skips the role. Auto keywords match words with symbols (`.env`, `c++`) and English next to Thai.
- Team runs print one progress line per role on stderr; MCP `orch_run` parameters have descriptions and the result footer lists assets one per line.

- Roles (phase 3): adjacent read-only roles (`writes: false`, for example `reviewer` and `security`) run in parallel, at most `pipeline.maxParallel` (default 2) at a time; roles that edit files still run alone. Saves time, not tokens. Results, artifacts and handoffs stay in plan order, a failing role does not cancel its sibling, and `--sequential` or `pipeline.parallel: false` restores one-at-a-time. `--dry-run` marks roles that would run together. A role you add now defaults to `writes: true` (it never runs in parallel unless you set `writes: false`).

- Roles (phase 2): built-in `architecture`, `designer` and `security` roles and the `full` team. The `designer` needs Codex (`needs: [image]`): orch creates `.orch/runs/<run-id>/assets/`, names it in the prompt and reports the files actually left there (`assets:`). Headless Codex image generation was verified with a real run (valid PNG) and costs about 121,000 input tokens for a small logo. A context preset that disables `image_generation` (such as `minimal`) now makes image roles skip with that reason.
- Automatic role selection: `orch run --auto`, `auto.enabled`, `--no-auto`, `auto.maxRoles` and `auto.keywords`; `orch explain "<prompt>"` shows the choice without a model call. A question (a trailing question mark, more question words, Thai questions) selects no roles and runs as one plain call; keywords match common word endings; `auto.keywords` can select roles you defined; selection is capped and the dropped roles are listed (also in the MCP footer).
- Config validation: role names are limited to letters, digits, `-` and `_`; empty teams and non-mapping role entries are rejected.

- Roles (phase 1): `orch run --role NAME`, `--team NAME` or `--roles A,B` run a task through specialised roles (built-in `developer`, `tester`, `reviewer`; teams `quick` and `standard`), one ordinary run per role with its own agent, model, context and permission flags. Roles hand short `## Handoff` summaries to each other and save full answers under `.orch/runs/<run-id>/`. `--dry-run` shows the plan and the number of model calls; `--keep-going` and `--require-codex` control failures and the Codex readiness gate (installed, logged in, image generation enabled, not cooling down) for roles with `needs: [image]`. `orch usage --by role` shows what each role cost. Plain `orch run` is unchanged.

- Context presets: `contexts` in the config (built-in `lean` and `minimal`) and `context:` on rules, `orch run --context NAME`, and a `context` parameter on MCP `orch_run` add flags that skip user-level settings, hooks, plugins and skills to shrink the fixed context of each call. Off unless selected; a failover keeps the preset name with the other agent's flags. `orch usage --by context` compares presets; `orch status` shows the preset used.
- Benchmarks: experiment E measures presets against the default context (about -48% cost on small Claude tasks, -18% input per Codex call).

- Benchmarks page (English and Thai) with real measurements of where orch saves tokens and cost, plus a reproducible harness (`npm run benchmark`, `scripts/benchmark.ts`) and the raw results in `benchmarks/`.

- Usage ledger: every attempt is recorded in `~/.orch/usage.jsonl` with token counts (and cost for Claude). New `orch usage [--since 24h|7d] [--by agent|model]`, token totals in `orch status`, and `tokens=<n>` in the MCP `orch_run` result.
- Agents now run in JSON mode by default (`--output-format json`, `--json`); new `output` setting per agent. `orch run` prints the clean final answer once; unexpected output falls back to plain text. Limit and login detection now reads the parsed error text, so failures reported in JSON are classified correctly.
- Failure messages show the agent's reported error instead of empty stderr.

## 0.2.1 (2026-10-17)

- Package metadata: `repository`, `homepage` and `bugs` now point to https://github.com/imfeemily/orch so the npm page links to the source and the docs site.
- Documentation site (VitePress) with English and Thai guides, a developer guide, and reference pages generated from the code; deployed to GitHub Pages from `main`.
- CI checks that keep docs in step with code (docs coverage tests, pull request gate, PR template).

## 0.2.0

- Per-rule `model` and `effort`: route small tasks to a cheaper model. Applied only to the rule's own agent; `modelArgs` / `effortArgs` templates per agent.
- `orch status` shows the model used for each job.

## 0.1.1

- Cooldown follows the reset time in the limit message ("try again at 10:05 PM", epoch suffix, "in 2 hours"); falls back to `defaultCooldownSec`.
- Login failures are classified as `auth`, reported with the fix, and set no cooldown. New `authPatterns` setting.
- Cheaper handoff: diffs over 4000 characters are replaced by `git diff --stat`; the first agent is asked for a summary only after a plain failure.

## 0.1.0

- Local daemon, `orch` CLI and `orch-mcp` server routing tasks between Claude Code and Codex with a single failover.
- Cooldown on rate limits, handoff with the original prompt and git state, recursion guard, cancellation stops the running agent.
- `orch init`, `orch status`, `orch daemon start|stop`; MCP tools `orch_run` and `orch_status`.
