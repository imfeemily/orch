export const USAGE = `usage:
  orch run [--cwd DIR] <prompt>   run a task (fails over between claude and codex)
  orch status                     show cooldowns and recent jobs
  orch init                       create ~/.orch/config.yaml if missing
  orch usage [--since 24h|7d] [--by agent|model]   token usage from the ledger
  orch daemon start|stop`;
