# Configuration

Configuration lives in `~/.orch/config.yaml` (create it with `orch init`). Every key is optional: anything you leave out keeps the built-in default, listed in the generated [defaults reference](/reference/config). Restart the daemon after editing: `orch daemon stop`.

```yaml
defaultAgent: claude
agents:
  claude:
    command: claude
    args: ["-p", "--", "{prompt}"]
    defaultCooldownSec: 3600
rules:
  - match: "typo|rename|quick|small fix"
    agent: codex
    model: gpt-6-luna
    effort: low
```

## Top-level keys

- `defaultAgent`: `claude` or `codex`. Used when no rule matches.
- `agents`: settings per agent (`claude`, `codex`); see below.
- `rules`: ordered list; the first rule whose `match` fits the prompt wins.

## Agent keys (`agents.<name>`)

- `command`: the executable to run.
- `args`: argument template. Every `{prompt}` is replaced by the prompt, which is always passed as one argument without a shell. Keep the `--` before `{prompt}` so a prompt starting with `-` is not read as a flag. Put permission or sandbox flags here.
- `output`: how orch reads the agent's stdout: `claude-json`, `codex-jsonl` or `text`. The JSON kinds give orch the clean answer and token usage; if the output does not match, orch falls back to plain text without usage. The default `args` include `--output-format json` (Claude) and `--json` (Codex); if you override `args`, keep that flag or set `output: text`.
- `summaryArgs`: template used to ask the agent for a handoff summary (resumes its last session). Remove it to disable summaries.
- `modelArgs`: inserted before `--` when a rule sets a `model`; every `{model}` is replaced.
- `effortArgs`: inserted before `--` when a rule sets an `effort`; every `{effort}` is replaced.
- `limitPatterns`: case-insensitive regexes. A non-zero exit whose stderr, or last 20 lines of stdout, matches one of them is a rate limit and puts the agent on cooldown.
- `authPatterns`: same matching; a hit means the agent is not logged in. Checked after `limitPatterns`.
- `defaultCooldownSec`: cooldown after a rate limit when the message gives no reset time (default 3600).

## Rule keys (`rules[]`)

- `match`: case-insensitive regex tested against the prompt.
- `agent`: which agent handles it.
- `model`: model for that agent when the rule matches. Requires the agent's `modelArgs`.
- `effort`: effort or reasoning level. Requires the agent's `effortArgs`.

`model` and `effort` apply only when the rule's own agent is used. If that agent is cooling down, or the task fails over, the other agent runs with its own defaults because model names are not portable between Claude and Codex. Use a model your account offers (in Codex, `/model` lists them).

Cheaper routing example: send small edits to a small model and keep the big model for hard work.

```yaml
rules:
  - match: "typo|rename|small fix"
    agent: codex
    model: gpt-6-luna
    effort: low
  - match: "refactor|architecture|migrate"
    agent: claude
    model: opus
    effort: high
```

## Environment variables

- `ORCH_HOME`: state directory (default `~/.orch`).
- `ORCH_CONFIG`: path of the config file (default `$ORCH_HOME/config.yaml`).
- `ORCH_DEPTH`: set by orch on the agents it starts. A value of 1 or more makes `orch` refuse to run, which stops an agent from calling orch recursively. Do not set it yourself.
