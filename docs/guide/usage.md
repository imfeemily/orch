# Usage

## Commands

```bash
orch run "add a health check endpoint"          # runs in the current directory
orch run --cwd ~/code/app "fix the failing test"
orch status                                     # cooldowns and recent jobs
orch init                                       # create ~/.orch/config.yaml if missing
orch daemon start                               # optional: it starts on demand
orch daemon stop                                # required after editing config.yaml
orch usage --since 7d --by model                # token usage from the ledger
```

- `orch run` prints the agent's final answer (an agent configured with `output: text` streams it live) and exits non-zero if both agents fail. When it fails over you will see `orch: switched agent, finished with <agent>` on stderr.
- `orch status` shows each agent as `available` or `cooling down, Nm left`, followed by the last jobs. A job that used a rule's model shows it in brackets.
- State lives in `~/.orch/state.json` (cooldowns and the last 50 jobs). Set `ORCH_HOME` to use another directory.

The complete command list is generated from the code: see the [CLI reference](/reference/cli).

## Usage and cost

orch records every agent attempt in `~/.orch/usage.jsonl` (kept for 90 days) and reads token counts from the agent's JSON output.

```bash
orch usage                         # last 24 hours, per agent
orch usage --since 7d --by model   # last 7 days, per model
```

- The token figure is *billable tokens*: input excluding cache reads, plus output (reasoning is already inside output). It is an approximation for tracking quota, not the vendor's own accounting.
- Claude also reports a cost in USD; Codex reports tokens only.
- `orch status` shows the last 24 hours per agent, and the MCP `orch_run` result ends with `tokens=<n>` (billable tokens of the final attempt).
- Agents are started in JSON mode (`--output-format json` for Claude, `--json` for Codex), so `orch run` prints only the final answer, once, when the agent finishes.

## From Claude Code and Codex (MCP)

```bash
claude mcp add orch -- orch-mcp
codex mcp add orch -- orch-mcp
```

If your Codex version has no `codex mcp add`, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.orch]
command = "orch-mcp"
tool_timeout_sec = 1800   # Codex's default tool timeout is short; real tasks take minutes
```

Tools:

- `orch_run({ prompt, cwd? })` runs a task and returns the agent's output followed by a `[orch] status=... agent=... failedOver=...` line. `cwd` defaults to the server's directory and must be an existing directory.
- `orch_status()` returns cooldowns and recent jobs as JSON.

Cancelling a call stops the running agent.

## How a task runs

1. **Route.** The first rule whose `match` regex fits the prompt picks the agent (and its `model`/`effort`); otherwise `defaultAgent`. An agent in cooldown is skipped.
2. **Run.** The agent starts headless (`claude -p`, `codex exec`) in the target directory.
3. **Fail over once.** On a non-zero exit the other agent gets the task. Only a rate-limit match puts the first agent on cooldown, until the reset time in the message when there is one, otherwise `defaultCooldownSec`. A "not logged in" error is reported with the fix and sets no cooldown.
4. **Hand over cheaply.** The second agent receives the original prompt and `git status`. The diff is inlined only when it is 4000 characters or less; otherwise `git diff --stat` and the agent reads files itself. A summary from the first agent is requested only after a plain failure.
5. **Guard.** Agents started by orch cannot call orch again (`ORCH_DEPTH`).
