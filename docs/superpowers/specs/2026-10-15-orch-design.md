# orch — Local Agent Orchestrator (Claude Code ⇄ Codex)

Date: 2026-10-15
Status: Draft for review

## Goal

A local daemon that accepts coding tasks, routes each to Claude Code or Codex,
and fails over to the other agent when the first hits a rate limit, quota, or
crash. It is callable from both Claude Code and Codex, so work can start from
either tool.

## Success criteria

- `orch run "<task>"` finishes the task using one agent, switching to the other
  automatically on rate limit or failure.
- Claude Code and Codex can each invoke orch (via MCP tool or shell command)
  and get the same behavior.
- Cooldown state survives across invocations (kept by the daemon).

## Out of scope (v1)

- UI / dashboard
- Cross-format transcript conversion between Claude and Codex
- Parallel write + review (cross-check) mode

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Use cases | Route by task type; fail over on quota/failure |
| Architecture | Local daemon (unix socket) + thin CLI and MCP clients |
| Language | TypeScript / Node |
| Handoff v1 | Original prompt + `git diff` / working-tree state |
| Handoff v2 | v1 + summary written by the first agent, when it can still respond |
| Location | `~/Documents/workspace/orch`, separate from travel-tracker |

## Layout

```
orch/
  src/core/     router, runner, handoff, state   (library; no daemon knowledge)
  src/daemon/   unix socket server at ~/.orch/sock, calls core
  src/cli/      `orch` command, thin client of the daemon
  src/mcp/      MCP server (stdio), thin client of the daemon
  config.yaml   routing rules, agent commands, rate-limit patterns
```

`core` is a plain library so it can also run without the daemon (single-shot
CLI mode) with no code changes.

## Components

- **Router** — picks an agent from rules in `config.yaml` (e.g. large
  refactor → claude, small/quick fix → codex). Skips any agent currently in
  cooldown. Falls back to a configured default.
- **Runner** — spawns `claude -p` or `codex exec` headless in the caller's
  working directory, streams output back, captures exit code and stderr.
- **Rate-limit detector** — classifies a run as limited/failed from exit code
  plus stderr patterns. Patterns live in `config.yaml` because CLI error text
  changes between releases.
- **Handoff** — builds the continuation prompt: original prompt, `git diff`,
  list of changed files, and (v2) the first agent's summary.
- **State** — `~/.orch/state.json`: per-agent cooldown-until timestamps and a
  short job log. Written atomically.
- **CLI** — `orch run`, `orch status`, `orch daemon start|stop`.
- **MCP server** — tools `orch_run` and `orch_status`, registered in both
  Claude Code and Codex.

## Data flow

1. Caller runs `orch run "task"` or the MCP tool `orch_run`.
2. Router selects an agent (rules, minus agents in cooldown).
3. Runner executes it in the caller's cwd and streams output.
4. On success, return the result.
5. On rate limit or failure, Handoff builds the continuation prompt and the
   other agent runs it.
6. The limited agent gets a cooldown timestamp in state.

## Error handling

- Both agents unavailable: return an error with remaining cooldown time; do
  not retry in a loop.
- At most one failover per task, to prevent ping-pong.
- Recursion guard: orch sets `ORCH_DEPTH`; a call made with `ORCH_DEPTH >= 1`
  is rejected, since a spawned agent could otherwise call orch again.
- Non-limit failures (e.g. task error, bad prompt) are returned as-is and
  do not trigger failover or cooldown.
- Unknown stderr on non-zero exit: treat as failure, fail over once, log the
  stderr so patterns can be added.

## Testing

- Unit: router rules, rate-limit detector, handoff builder, state file.
- Integration: fake agent scripts that emulate exit codes and stderr; no real
  CLI calls in automated tests.
- Manual smoke test with the real `claude` and `codex` once per release.

## Open items for planning

- Exact headless flags for each CLI (`claude -p`, `codex exec`) and how to
  pass the working directory and permission mode.
- Whether the daemon is started on demand by the first client or by launchd.
