# Changelog

All notable changes are listed here. Add user-visible changes under **Unreleased** in the same pull request that makes them.

## Unreleased

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
