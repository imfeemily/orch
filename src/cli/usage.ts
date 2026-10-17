export const USAGE = `usage:
  orch run [--cwd DIR] [--context NAME] [--role NAME | --team NAME | --roles A,B] [--dry-run] [--require-codex] [--keep-going] <prompt>
                                   run a task (fails over between claude and codex); roles split it into steps
  orch status                     show cooldowns and recent jobs
  orch init                       create ~/.orch/config.yaml if missing
  orch usage [--since 24h|7d] [--by agent|model|context|role]   token usage from the ledger
  orch daemon start|stop`;
