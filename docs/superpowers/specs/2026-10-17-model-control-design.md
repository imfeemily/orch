# Model control: usage ledger, tiers, auto selection, quota-aware routing

Date: 2026-10-17
Status: Draft for review
Builds on: `2026-10-15-orch-design.md` (v0.2.1)

## Goal

Let orch choose the agent **and** the model/effort for a task from portable intent
(tiers) and from signals it can measure (task difficulty, token usage), so work is
cheaper and runs into rate limits less often. Today a model is chosen only by static
regex rules, model names are not portable between Claude and Codex, and orch cannot
see how many tokens it has spent.

## Success criteria

- `orch usage` reports tokens (and cost where the CLI provides it) per agent, model and tier.
- A tier (`fast`, `balanced`, `deep`) selects the right model/effort for whichever agent runs, including after failover.
- With `auto` enabled, a task with no explicit choice gets a tier from a deterministic, explainable estimate (`orch explain`).
- With budgets configured, orch avoids starting work on an agent that is nearly out of its budget.
- A config file written for 0.2.x behaves exactly as before: every new feature is off until configured.
- Each of the four stages ships independently and works on its own.

## Out of scope

- A third agent or custom CLIs (a separate feature).
- Calling an LLM to classify difficulty (too expensive through the CLIs, see below).
- Learning thresholds from outcomes (later, once the ledger has data).
- Reading remaining quota from the vendors (not available non-interactively).

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Direction | Automatic selection driven by task difficulty and quota headroom |
| Approach | Local heuristic estimator + local usage ledger (no extra tokens) |
| Delivery | 1 measure, 2 tiers and overrides, 3 difficulty estimate, 4 quota routing |
| Failover | Keeps the tier; uses the other agent's own model for it |
| Escalation | If the first attempt **failed** (not limited), the failover runs one tier higher |
| Quota unit | Approximate tokens: input excluding cache reads + output (reasoning is already inside output) |

## Verified facts about the CLIs (2026-10-17)

- `claude -p --output-format json` prints one JSON object: `result` (final answer only),
  `is_error`, `usage` (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
  `output_tokens`), `total_cost_usd`, `modelUsage`, `duration_ms`.
- On failure (bad model) it exits 1 with the same object: `is_error: true`, `result` = the error
  text, `api_error_status`, and empty stderr.
- `codex exec --json` prints JSONL events. Success: `item.completed` with an `agent_message`
  (`text`) and `turn.completed.usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`,
  `reasoning_output_tokens`; no cost).
- On failure it exits 1 with `error` and `turn.failed` events whose `message` is a JSON string
  containing the real error; stderr holds only noise. An `item.completed` of type `error` is a
  non-fatal warning and must not be classified.
- Neither CLI exposes remaining quota non-interactively.
- Base context is large: a one-word answer used about 31,000 Claude input tokens and 21,600
  Codex input tokens on this machine, so classification by an LLM call through a CLI would
  cost more than it saves.

## Architecture

New pure modules in `src/core/`, wired into the existing orchestrator:

| Module | Responsibility |
|---|---|
| `output.ts` | `parseAgentOutput(kind, stdout)` returns `{ text, errorText?, usage? }`; kinds `claude-json`, `codex-jsonl`, `text` |
| `usage.ts` | `Usage` type, `billableTokens(usage)`, `Ledger` (append, read since) over `~/.orch/usage.jsonl` |
| `tiers.ts` | `resolveChoice(config, tier, agent)` returns `{ model?, effort? }`; `bumpTier(tier)` |
| `estimate.ts` | `estimateTier(prompt, signals)` returns `{ tier, score, reasons[] }` |
| `budget.ts` | `headroom(ledger, budget, now)`; `pickByHeadroom(...)` |

Existing modules change as follows: `config.ts` (new keys, defaults, validation),
`router.ts` (precedence and headroom), `orchestrator.ts` (parse, ledger, escalation),
`protocol.ts` / `server.ts` (new request fields), CLI (`usage`, `explain`, flags), MCP (params, compact result).

## Stage 1: measure

- `AgentConfig.output`: `claude-json` | `codex-jsonl` | `text`. Defaults add `--output-format json` /
  `--json` to each agent's `args`. A user config that overrides `args` without the flag still
  works: parsing falls back to `text` with no usage.
- The runner is unchanged. The orchestrator parses `stdout` with `parseAgentOutput`:
  - `text` is the final answer, returned to the caller (this also gives MCP callers the compact result).
  - Classification (`limited` / `auth` / `failed`) runs on `errorText ?? text` plus stderr, not on raw JSON,
    so the last-20-lines rule keeps working.
  - Summary calls (handoff v2) are parsed the same way.
- Streaming is not lost: both CLIs already print their answer only when finished.
- Ledger line per attempt in `~/.orch/usage.jsonl`:
  `{ at, taskId, agent, model?, tier?, outcome, usage?, costUsd?, durationMs, promptChars }`.
  Writes never fail a task. The file is trimmed to the last 90 days on daemon start.
- `orch usage [--since 24h|7d] [--by agent|model|tier]` prints totals; `orch status` shows tokens for the last 24h.
- `orch_run` (MCP) returns the final answer and a one-line footer with agent, model and tokens.

## Stage 2: tiers and overrides

```yaml
tiers:
  fast:     { claude: { model: haiku,  effort: low },    codex: { effort: low } }
  balanced: { claude: { model: sonnet, effort: medium }, codex: { effort: medium } }
  deep:     { claude: { model: opus,   effort: high },   codex: { effort: high } }
# defaultTier: balanced     # unset by default: tasks no rule/auto/override picks run with no model flags
rules:
  - match: "typo|rename|quick"
    tier: fast                 # agent optional; legacy model/effort rules still work
```

- Defaults are safe: Claude uses stable aliases; Codex sets only `effort` because model names depend on the account. The built-in `tiers` are only used when something selects a tier; `defaultTier` has **no default**, so a task that no override, rule or auto estimate picks a tier for runs exactly as in 0.2.x.
- A tier name must exist in `tiers`; a rule may not mix `tier` with `model`/`effort`; validated at load.
- A tier with no entry for an agent runs that agent with its defaults.
- Per-call overrides: `orch run --tier T --agent A --model M --effort E`, and the same optional fields on MCP `orch_run`
  and the daemon `run` request. Unknown tier or agent is an error naming the valid values.
- **Precedence:** explicit model/effort > explicit tier > rule > auto estimate > `defaultTier` (if set; otherwise no model flags). `--agent` picks the
  preferred agent; failover still applies.
- **Failover:** the second agent receives the same tier (one step higher after a plain failure, capped at `deep`).

## Stage 3: difficulty estimate

- `estimateTier(prompt, signals)` is a pure function. Signals: prompt length, count of file paths and identifiers,
  number of list steps, hits from a weighted keyword table (deep: refactor, migrate, architecture, security,
  concurrency, performance, "across the codebase"; easy: typo, rename, comment, readme, format, explain, "where is"),
  and `git status` changed-file count when the cwd is a repository.
- Score thresholds map to a tier; defaults are in code and overridable under `auto.thresholds`.
- `auto: { enabled: false }` by default. `orch explain "<prompt>"` prints the tier, score and reasons without running anything.
- The chosen tier and reasons are recorded on the ledger line and shown by `orch status`.

## Stage 4: quota-aware routing

```yaml
budgets:
  claude: { tokens: 2000000, window: 24h }
  codex:  { tokens: 1500000, window: 24h }
reserve: 0.10
```

- `headroom = 1 - used/tokens` over the rolling window, from the ledger.
- For a task with no pinned agent: skip an agent whose headroom is below `reserve` (as if cooling), unless every
  agent is below it; otherwise prefer the preferred agent, falling back to the one with more headroom.
- An agent with no budget is treated as unconstrained.
- `orch usage --suggest-budget` prints the usage observed in the window before each past rate limit. It never edits config.

## Data flow of `runTask` (after all stages)

1. Reject recursion; resolve the request: explicit fields, else rule, else auto estimate, else `defaultTier` if set (else no tier).
2. Choose the agent: pinned or rule agent or default, adjusted by cooldown and headroom.
3. Resolve model/effort for that agent from the tier; build argv; run.
4. Parse output; classify; write the ledger line; set a cooldown on `limited`.
5. On non-`ok` and not aborted: choose the other agent, bump the tier after a plain failure, hand over, run once, parse, ledger.

## Error handling and compatibility

- Parser failure or unknown JSON shape: use raw stdout as `text`, no usage, and continue.
- Ledger or state write failure is swallowed (and logged to stderr by the daemon); the task result is still returned.
- Existing configs: new keys absent means no tiers, no auto, no budgets, behavior of 0.2.x. The new default `args`
  and `output` apply only when the user did not override them.
- Tier validation errors fail at config load with a message naming the key.

## Testing

- Golden fixtures captured from real output (Claude success and failure JSON, Codex success and failure JSONL) and a
  malformed sample for the fallback path.
- Table tests for `estimateTier` (prompt, expected tier, expected reasons).
- `Ledger` and `headroom` on temp directories with a fixed `now`; window edges and trimming.
- `resolveChoice`, precedence, escalation and failover-keeps-tier through `runTask` with a fake `RunFn`.
- Config validation tests for each new key; docs-coverage tests extended to the new keys, commands and env vars.
- Manual smoke test: real `claude` and `codex` produce parseable output and a ledger line; failure case via a bad model.

## Documentation

Per the documentation policy: `guide/usage` (`usage`, `explain`, flags), `guide/configuration` (tiers, auto, budgets,
output), `developer/architecture` (new modules, data flow), `troubleshooting` (budget and parse messages), Thai pages,
and `CHANGELOG.md`.

## Risks and open items for planning

- Parsing depends on each CLI's JSON shape; mitigated by fallback to `text` and fixtures that document the shape.
- Token counts are approximate for quota purposes (Claude cache-creation and Codex cached input are weighted by us, not by the vendor).
- Heuristic accuracy is moderate; `orch explain` and the ledger exist so thresholds can be tuned from evidence.
- Resolved in Stage 1: summary calls keep their text-mode `summaryArgs` (not forced to JSON) and are parsed with the same fallback, so the `-c` resume behavior is untouched.
