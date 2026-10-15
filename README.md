# orch

Local daemon that routes coding tasks to Claude Code or Codex and fails over to the other on rate limit or failure.

## Install

```bash
npm install
npm run build
npm link            # puts `orch` on your PATH
mkdir -p ~/.orch && cp config.example.yaml ~/.orch/config.yaml
```

## Use

```bash
orch run "add a health check endpoint"
orch status
orch daemon stop    # needed after editing ~/.orch/config.yaml
```

The daemon starts on demand. Cooldowns and recent jobs live in `~/.orch/state.json`.

## Register as an MCP server

```bash
claude mcp add orch -- node "$(pwd)/dist/mcp/index.js"
codex mcp add orch -- node "$(pwd)/dist/mcp/index.js"
```

If your Codex version has no `codex mcp add`, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.orch]
command = "node"
args = ["/absolute/path/to/orch/dist/mcp/index.js"]
```

## Notes

- Codex's MCP tool timeout is short by default; for long tasks raise `tool_timeout_sec` for the `orch` server in `~/.codex/config.toml`. Cancelling a call stops the running agent.
- Codex may start MCP servers with a restricted environment, so the recursion guard (`ORCH_DEPTH`) is guaranteed for the `orch` CLI but not verified for the MCP path from Codex.

- Permission/sandbox flags for each agent go in `args` in `~/.orch/config.yaml`.
- Rate-limit detection is regex-based (`limitPatterns`); add patterns if a real limit error is not detected (check `orch status`: a limit shows as a cooldown, a plain failure does not).
- A spawned agent that calls `orch` again is rejected via `ORCH_DEPTH`.
- Set `ORCH_HOME` to use a different state directory (handy for testing).
