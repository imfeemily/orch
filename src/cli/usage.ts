export const USAGE = `usage:
  orch run [--cwd DIR] [--context NAME] [--role NAME | --team NAME | --roles A,B | --auto | --no-auto] [--dry-run] [--require-codex] [--keep-going] [--sequential] [--only claude|codex] <prompt>
                                   run a task (fails over between claude and codex); roles split it into steps
  orch explain [--only claude|codex] <prompt>
                                   show which roles --auto would pick, or with --only the tier and model, and why (no model call)
  orch mcp-config <vscode|cursor|claude-desktop> [--write] [--cwd DIR]
                                   print (or with --write add) the orch MCP entry for an editor or chat app
  orch status                     show cooldowns and recent jobs
  orch init                       create ~/.orch/config.yaml if missing
  orch usage [--since 24h|7d] [--by agent|model|context|role]   token usage from the ledger
  orch daemon start|stop`;
