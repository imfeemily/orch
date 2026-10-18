# How it works

orch sits between your tools and the two coding agents. Everything runs on your machine, using the Claude Code and Codex subscriptions you already have.

## Architecture

![Clients talk to the orch daemon over a unix socket; the router picks agent, model and tier; the runner starts the Claude or Codex CLI; state and the usage ledger sit beside it](/img/architecture.svg)

Any client (the terminal, Claude Code, Codex, VS Code, Cursor, Claude Desktop) sends the task to one local daemon. The **router** picks the agent, model and tier from the prompt and your rules. The **runner** starts the real `claude` or `codex` command. **State** remembers cooldowns and the **usage ledger** records tokens, so `orch usage` can show what each agent, model and role cost.

## Failover

![A task is classified into a tier, routed and run; on a rate limit or failure orch records a cooldown, writes a handoff note and finishes on the other agent](/img/failover.svg)

When an agent hits a rate limit or fails, orch records a cooldown (using the reset time the agent reports), builds a handoff from the original prompt, your `git diff` and a short summary, and finishes the task on the other agent. With `--only` it does not fail over and tells you instead.

## Roles and teams

![Developer, then tester, then reviewer and security in parallel, collected as artifacts; the designer role uses Codex to make images](/img/roles.svg)

A team runs roles in order and passes a short handoff from each to the next. Adjacent read-only roles (reviewer, security) run in parallel, which saves time but not tokens. The designer role needs Codex because only Codex can make images. See [Roles](/guide/roles).
