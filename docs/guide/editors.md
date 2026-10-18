# Editors and chat apps

orch works from any app that supports MCP (Model Context Protocol), not only from the command line: **VS Code with Copilot** (agent mode), **Cursor**, and **Claude Desktop**. The app starts `orch-mcp` itself and gets the `orch_run` and `orch_status` tools plus three ready-made prompts. You do not run `orch` by hand.

Install orch first (`npm install -g claude-codex-orch`), then add it to your app.

## One command

```bash
orch mcp-config vscode            # print the JSON and the file it belongs in
orch mcp-config vscode --write    # add the entry to that file
```

Use `cursor` or `claude-desktop` instead of `vscode` for those apps. `--write` keeps every other server in the file, says `unchanged` when orch is already there, and refuses (changes nothing) when the file has comments or is not plain JSON; then paste the printed entry in by hand. Restart the app afterwards.

| App | File | Scope |
|---|---|---|
| VS Code (Copilot agent mode) | `.vscode/mcp.json` in the project (`--cwd DIR` picks the project) | one project |
| Cursor | `~/.cursor/mcp.json` | every project |
| Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`, Linux `~/.config/Claude/claude_desktop_config.json` | every chat |

By hand, the VS Code entry is:

```json
{ "servers": { "orch": { "type": "stdio", "command": "orch-mcp", "args": [] } } }
```

Cursor and Claude Desktop use `mcpServers` instead of `servers` and no `type`:

```json
{ "mcpServers": { "orch": { "command": "orch-mcp", "args": [] } } }
```

## Using it

- Ask in the chat: "use orch to fix the typo in README.md". The assistant calls `orch_run`; orch picks Claude Code or Codex, fails over on a rate limit, and returns the answer with the agent, tokens and any roles used.
- The prompts `orch-fix`, `orch-review` and `orch-explain` appear in the app's prompt menu (in VS Code, type `/` in chat and look for `mcp.orch`). Each takes one `task` and tells the assistant exactly how to call `orch_run`: `orch-fix` uses the `developer` role, `orch-review` the `reviewer` role, and `orch-explain` asks one question on Claude without editing.
- Any option from [Usage](/guide/usage) (`role`, `team`, `auto`, `only`, `context`, `dryRun`) can be requested in plain words or passed as tool arguments.

## Check it works

1. Run `orch mcp-config <app>` and make sure the file it names contains the entry.
2. Restart the app, then open its list of tools or MCP servers: `orch` should show as running with `orch_run` and `orch_status`.
3. Ask for a dry run: "call orch_run with dryRun true, roles developer and tester, and show the plan". It uses no tokens.

If the app cannot find `orch-mcp`, it was installed in a place the app's PATH does not include (common with nvm). Put the full path in `command`: `which orch-mcp` shows it.

## What does not work

Web and mobile chat (claude.ai in a browser, phone apps) cannot start programs on your computer, so they cannot use orch. That needs a remote HTTP server with sign-in, which orch does not provide.
