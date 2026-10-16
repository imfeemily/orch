# Getting started

`orch` is a local daemon, CLI and MCP server. It routes each coding task to **Claude Code** or **Codex** and fails over to the other when the first hits a rate limit or fails.

## Requirements

- Node.js 20 or newer
- `claude` (Claude Code) and `codex` installed and logged in on the same machine
- macOS or Linux (it uses a unix domain socket)

## Install

```bash
npm install -g claude-codex-orch
orch init
```

`orch init` creates `~/.orch/config.yaml` if it does not exist and never overwrites an existing file.

## Run your first task

```bash
orch run "reply with exactly the word pong and nothing else"
```

You should see `pong`. The daemon starts by itself on the first command.

## Use it from Claude Code and Codex

```bash
claude mcp add orch -- orch-mcp
codex mcp add orch -- orch-mcp
```

Then ask either tool to use the `orch_run` tool. See [Usage](/guide/usage) for details and the Codex timeout setting.

## Next

- [Usage](/guide/usage): every command and the MCP tools
- [Configuration](/guide/configuration): routing rules, models, cooldowns
- [Troubleshooting](/guide/troubleshooting)
