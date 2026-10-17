# Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Failed to authenticate: OAuth session expired` | Claude is logged out. Open `claude`, run `/login`. orch reports it as "not logged in" and fails over. |
| `The '<model>' model is not supported when using Codex with a ChatGPT account` | Wrong model slug in `~/.codex/config.toml` or in a rule. Pick one from `/model` inside `codex` and test with `codex exec -c model='"<slug>"' "say pong"`. The slug can differ from the display name. |
| `You've hit your usage limit` | A real limit. orch puts that agent on cooldown until the reset time in the message, and uses the other agent. See `orch status`. |
| `Not inside a trusted directory` (Codex) | Run in a git repository, or add `--skip-git-repo-check` to Codex's `args`. |
| `orch daemon did not start` | Run `node "$(npm root -g)/claude-codex-orch/dist/daemon/index.js"` in a terminal to see the error, often a typo in `config.yaml`. |
| `orch usage` shows nothing, or tokens stay 0 | orch fell back to plain text: you overrode `args` without the JSON flag, or the CLI changed its output format. Re-add `--output-format json` (Claude) or `--json` (Codex), or set `output: text` to stop expecting JSON. |
| A `--context` preset makes the agent fail with an unknown option | The agent CLI does not know a flag in the preset (feature names differ by version). Edit that preset under `contexts` in `~/.orch/config.yaml`, then `orch daemon stop`. |
| With `context: lean` an agent ignores your global permissions or instructions | By design: `lean` skips user-level settings. Put needed permissions in the agent's `args` (for example `--permission-mode acceptEdits`) or in the project's own settings. |
| `role "x" skipped: not logged in ...` | The role needs Codex and Codex is not ready. Follow the reason (for example `codex login`), or add `--require-codex` to stop instead of skipping. |
| `unknown role` or `unknown team` | The name is not in `roles` or `teams`; the message lists the valid names. |
| A team stopped and later roles show `not-run` | A role failed after failover. Fix the cause and rerun, or use `--keep-going`. Full answers are in `.orch/runs/<run-id>/`. |
| `developer` or `tester` cannot edit files | The role is missing the agent's permission flags. The built-in roles carry them; add `agentArgs` to your own roles that write. |
| Config edits are ignored | The daemon reads the config once. Run `orch daemon stop`; the next command restarts it. |
| `cwd must be an existing absolute directory` | The MCP client sent a missing path. Pass an absolute `cwd`. |
| Long task times out from Codex | Raise `tool_timeout_sec` for the `orch` MCP server in `~/.codex/config.toml`. |

## Checking what orch did

```bash
orch status
```

Shows cooldowns and the last jobs, with `(failover)` and the model when one was used. A rate limit appears as a cooldown; a plain failure does not.

## Known limitations

- Multi-byte characters can be garbled if a chunk boundary splits them.
- `orch daemon stop` during a running task can remove the next daemon's socket.
- No overall timeout on the main task run.
- No Windows support.
