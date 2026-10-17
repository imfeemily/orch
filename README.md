# claude-codex-orch

A local daemon, CLI (`orch`) and MCP server that routes coding tasks to
**Claude Code** or **Codex** and fails over to the other one when the first hits
a rate limit or fails. Start from either tool; orch picks the agent, remembers
cooldowns, and hands the work over (original prompt + `git diff` + a summary
from the first agent when it can still answer).

Documentation: https://imfeemily.github.io/orch/ (guides in English and Thai, developer guide, reference); sources in [docs/](docs/). Thai quick start: [docs/th/guide/getting-started.md](docs/th/guide/getting-started.md).

## Requirements

- Node.js 20 or newer
- `claude` (Claude Code) and `codex` installed and logged in on the same machine
- macOS or Linux (unix domain socket)

## Install

```bash
npm install -g claude-codex-orch
orch init            # creates ~/.orch/config.yaml if it does not exist
```

## Use

```bash
orch run "add a health check endpoint"       # runs in the current directory
orch run --cwd ~/code/app "fix the failing test"
orch status                                  # cooldowns + recent jobs
orch usage --since 7d --by model             # token usage from the ledger
orch daemon stop                             # also required after editing config.yaml
```

The daemon starts on demand. State (cooldowns, last 50 jobs) lives in
`~/.orch/state.json`; set `ORCH_HOME` to use another directory.

### Call it from Claude Code and Codex (MCP)

```bash
claude mcp add orch -- orch-mcp
codex mcp add orch -- orch-mcp
```

If your Codex version has no `codex mcp add`, add to `~/.codex/config.toml`:

```toml
[mcp_servers.orch]
command = "orch-mcp"
tool_timeout_sec = 1800   # Codex's default tool timeout is short; real tasks take minutes
```

Tools exposed: `orch_run({ prompt, cwd? })` and `orch_status()`.

## How it works

1. **Route**: rules in `config.yaml` (regex on the prompt) pick an agent; otherwise `defaultAgent`.
   An agent in cooldown is skipped.
2. **Run**: the agent is started headless (`claude -p`, `codex exec`) in the target directory.
3. **Fail over once**: on a non-zero exit, orch hands the task to the other agent.
   Only a rate-limit match (see `limitPatterns`) puts the first agent on cooldown.
   If the limit message says when it resets (for example "try again at 10:05 PM"),
   that time is used; otherwise `defaultCooldownSec` (1 hour by default).
   A "not logged in" error (see `authPatterns`) is reported with the fix
   (`claude` then `/login`, or `codex login`) and does not set a cooldown.
4. **Hand over cheaply**: the second agent gets the original prompt plus
   `git status`; the diff is inlined only when small (4000 chars), otherwise
   just `git diff --stat` and the agent reads files itself. A summary from the
   first agent is requested only after a plain failure, never after a limit or
   login error (a resumed session cannot answer then).
5. **Guard**: an agent started by orch cannot call orch again (`ORCH_DEPTH`).
   Cancelling the call stops the running agent.

## Configuration (`~/.orch/config.yaml`)

```yaml
defaultAgent: claude
agents:
  claude:
    command: claude
    args: ["-p", "--", "{prompt}"]               # "--" so a prompt starting with "-" is not a flag
    summaryArgs: ["-c", "-p", "--", "{prompt}"]  # asks the first agent for a handoff summary
    defaultCooldownSec: 3600
  codex:
    command: codex
    args: ["exec", "--", "{prompt}"]
    summaryArgs: ["exec", "resume", "--last", "--", "{prompt}"]
    defaultCooldownSec: 3600
rules:
  - match: "refactor|architecture|migrate|redesign"
    agent: claude
  - match: "typo|rename|quick|small fix|one-liner"
    agent: codex
```

- Add permission or sandbox flags for an agent to its `args`.
- **Pick a model per task type** (the biggest token saver: send small tasks to a small
  model). Add `model` and/or `effort` to a rule; they apply only when that rule's agent
  is used, not to the agent it fails over to (model names are not portable):

  ```yaml
  rules:
    - match: "typo|rename|quick|small fix|one-liner"
      agent: codex
      model: gpt-6-luna      # use a model your account offers (see /model in codex)
      effort: low
    - match: "refactor|architecture|migrate|redesign"
      agent: claude
      model: opus
      effort: high
  ```

  The flags come from each agent's `modelArgs` / `effortArgs` templates
  (defaults: Claude `--model` / `--effort`, Codex `-m` / `-c model_reasoning_effort=`).
  `orch status` shows the model used for each job.
- **Shrink the fixed context** of small tasks with a preset: add `context: lean` to a rule, or run `orch run --context lean "..."`. Presets skip user-level hooks, plugins and skills (about -48% cost on small Claude tasks in the benchmarks) and are off unless selected. See the Configuration page.
- `limitPatterns` and `authPatterns` (regexes matched against stderr and the last
  20 lines of stdout) can be overridden per agent if a real error is not detected.
- Remove `summaryArgs` to disable the handoff summary.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Failed to authenticate: OAuth session expired` | Open `claude`, run `/login`. |
| `The '<model>' model is not supported when using Codex with a ChatGPT account` | Wrong model slug in `~/.codex/config.toml`. Pick one from `/model` inside `codex` and test with `codex exec -c model='"<slug>"' "say pong"`; the slug can differ from the display name. |
| `You've hit your usage limit` | Real limit. orch puts that agent on cooldown and uses the other. Check `orch status`. |
| `orch daemon did not start` | Run `node "$(npm root -g)/claude-codex-orch/dist/daemon/index.js"` in a terminal to see the error (often a typo in `config.yaml`). |
| Config edits ignored | `orch daemon stop`; the next command restarts it. |

## Security

The daemon listens on `~/.orch/sock` (mode 0600, owner only). Agents run with
your permissions, so anything that can talk to the socket can run agents as you.

## Uninstall

```bash
orch daemon stop
npm uninstall -g claude-codex-orch
claude mcp remove orch
rm -rf ~/.orch            # also remove the [mcp_servers.orch] block from ~/.codex/config.toml
```

## Known limitations

- Multi-byte characters can be garbled if split across output chunks.
- `orch daemon stop` during a running task can remove the next daemon's socket.
- No overall timeout on the main task run.
- No Windows support.
