# Architecture

orch is a pure library (`core`) wrapped by a daemon, with two thin clients (CLI and MCP server). Nothing in `core` knows about sockets or the CLI.

```
 CLI ──────┐               ┌─ router
           ├─ ~/.orch/sock ┤  runner (spawns agents)
 MCP ──────┘   daemon      │  detector, reset time
                           │  handoff (prompt + git)
                           └─ state.json
```

## Modules

| Path | Responsibility |
|---|---|
| `src/core/types.ts` | Shared types: `Config`, `RunFn`, `TaskResult`, `Outcome`, ... |
| `src/core/config.ts` | Defaults, YAML loading and merge, validation, `initConfig`, `orchHome` |
| `src/core/router.ts` | `pickRoute`: rule match, cooldown skip, model/effort for the rule's agent, context name for either agent |
| `src/core/agent-args.ts` | `buildAgentArgs`: insert model/effort and context-preset flags before the `--` guard |
| `src/core/runner.ts` | `runCommand`: spawn without a shell, stream stdout, timeout, abort, `ORCH_DEPTH` |
| `src/core/detector.ts` | `classify`: `ok`, `limited`, `auth` or `failed` from exit code and output |
| `src/core/output.ts` | `parseAgentOutput`: the answer, error text and token usage from Claude JSON, Codex JSONL or plain text; anything unexpected falls back to the raw text |
| `src/core/usage.ts` | `Ledger` (`usage.jsonl`, never throws), `summarize`, `billableTokens`, `parseDuration` |
| `src/core/reset.ts` | `parseResetTime`: reset time from a limit message (clock, epoch, relative) |
| `src/core/handoff.ts` | `buildHandoff`: original prompt, `git status`, diff or `--stat`, summary |
| `src/core/state.ts` | `StateStore`: cooldowns and the last 50 jobs, atomic JSON writes |
| `src/core/orchestrator.ts` | `runTask`: the whole flow, one failover, recursion guard |
| `src/daemon/*` | Socket server, client helpers (`sendRequest`, `connectOrStart`), protocol types |
| `src/cli/*` | `parseArgs`, shared `USAGE` text, the `orch` entry point |
| `src/mcp/index.ts` | MCP stdio server exposing `orch_run` and `orch_status` |

## Data flow of `runTask`

1. Reject when `depth >= 1` (an orch-started agent called orch).
2. `pickRoute` chooses an agent that is not cooling down, plus the matching rule's model/effort/context. An explicit `context` on the request wins over the rule's; an unknown name is rejected before anything runs. The preset's flags for the chosen agent are added to its argv, and a failover uses the same preset name with the other agent's flags. All agents cooling returns status `unavailable`.
3. `runAttempt` builds argv with `buildAgentArgs`, runs it, **parses the output** into answer, error text and usage, then **scrubs the prompt out of that text** (CLIs echo it, and the handoff text itself contains "rate limit") before classifying. Every attempt is appended to the usage ledger. JSON agents are not streamed: their raw stdout is machine output, so the CLI prints the final answer once.
4. `limited` sets a cooldown: the parsed reset time, else `defaultCooldownSec`.
5. On anything but `ok`: if the caller aborted, stop. If the other agent is cooling, return `failed`. Otherwise build the handoff (asking the first agent for a summary only after a plain `failed`) and run the other agent once, without the rule's model.
6. Every outcome except `rejected` appends a job record.

## Classification

`classify` checks, in order: exit code 0 is `ok`; a `limitPatterns` match is `limited`; an `authPatterns` match is `auth`; anything else is `failed`. Only stderr and the **last 20 lines of the parsed output** (the agent's error text when it reported one, otherwise its answer) are searched, so an agent's work text that mentions "rate limit" cannot trigger a cooldown.

## Daemon protocol

Newline-delimited JSON over `~/.orch/sock` (mode 0600).

- Requests: `{type:"run", prompt, cwd, depth}`, `{type:"status"}`, `{type:"shutdown"}`
- Replies: zero or more `{type:"chunk", text}` then one of `result`, `status`, `ok`, `error`

The server validates `cwd` (absolute, existing directory). Each connection owns an `AbortController`; closing the socket aborts the running agent and prevents failover.

A client starts the daemon on demand (`connectOrStart`) after loading the config itself, so a broken config fails loudly in the client instead of silently in the background.

## State

`~/.orch/state.json`: `{ cooldowns: { claude?: ms, codex?: ms }, jobs: JobEntry[] }`. Missing or corrupt files read as empty. Writes go to a temp file and are renamed.

## Usage ledger

`~/.orch/usage.jsonl` is an append-only JSON Lines file with one entry per attempt (`at`, `taskId`, `agent`, `model?`, `outcome`, `usage?`, `durationMs`, `promptChars`). A failover writes two entries with the same `taskId`. Writes never throw, corrupt lines are skipped on read, and the daemon trims entries older than 90 days at start. `orch usage` and `orch status` read the file directly; no daemon round trip.

Token units: `inputTokens` excludes cache reads (Claude's cache creation counts as input; Codex's cached input is subtracted), and `billableTokens = inputTokens + outputTokens`.

## Design decisions worth knowing

- **Single failover.** More hops waste tokens and risk ping-pong.
- **Cooldown only for limits.** A plain failure should not bench a healthy agent.
- **Model names are not portable.** A rule's `model` is used only with that rule's agent.
- **No shell, one argv element.** The prompt can contain anything; `--` keeps it from being parsed as a flag.
- **Config is read once** by the daemon; restart after editing.
