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
- `contexts`: named presets of extra flags that shrink the fixed context of each call; see [Context presets](#context-presets).
- `roles`, `teams`, `pipeline`: specialised runs and the named sets of them; see [Roles and teams](#roles-and-teams).
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
- `context`: name of a `contexts` preset to apply. Unlike `model`, it also applies when the task falls over to the other agent, using that agent's own flags.

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

## Context presets

Every call to Claude Code or Codex first loads a large fixed context: your user-level settings, hooks, plugins and skills. For a small task this is most of the bill. A context preset adds flags that skip part of it. Presets are off unless you pick one, so nothing changes by default.

```yaml
contexts:
  lean:
    claude: ["--setting-sources", "project", "--disable-slash-commands"]
    codex: ["--disable", "hooks", "--disable", "plugins", "--disable", "apps"]
rules:
  - match: "typo|rename|small fix|explain"
    agent: claude
    model: haiku
    context: lean
```

Built-in presets (see the [defaults reference](/reference/config) for the exact flags):

- `lean`: skips user-level settings (plugins, hooks, personal instructions) and skills for Claude, and hooks, plugins and apps for Codex. Project instructions (`CLAUDE.md`, `AGENTS.md`) are kept. About -48% cost on small Claude tasks and -18% input per Codex call in the [benchmarks](/guide/benchmarks).
- `minimal`: Claude `--safe-mode` and more Codex features off. The biggest saving (-68% on a one-word call), but Claude also ignores the project's `CLAUDE.md`.

Choose a preset with `context:` in a rule, `orch run --context lean`, or the `context` parameter of the MCP `orch_run` tool. Precedence: explicit choice, then rule, then none. An unknown name is rejected with the list of valid names.

Things to know before using one:

- `lean` skips **user-level** settings, so your personal allow rules, hooks and instructions do not apply to those runs. Put the permissions an agent needs in its `args` (for example `--permission-mode acceptEdits`) or in the project's own settings.
- Your own presets are merged with the built-in ones by name and by agent, so you can add `mine:` or change just `lean.codex`.
- Flag and feature names belong to each CLI and change between versions. If a CLI rejects a flag, the run fails and orch fails over; fix the preset and run `orch daemon stop`.
- `orch usage --by context` compares presets from your own usage.

## Roles and teams

A role is a specialised run (developer, tester, reviewer, ...). See the [Roles](/guide/roles) page for how they run; this section lists the config keys. Built-in roles and teams are in the [defaults reference](/reference/config); your entries are merged with them by name and by key, so you can add `mine:` or change just `reviewer.model`.

```yaml
roles:
  reviewer:
    prompt: "You are a code reviewer. ..."
    agent: claude          # optional: pin an agent; otherwise normal routing
    model: haiku           # optional
    effort: low            # optional
    context: lean          # a context preset name
    needs: []              # capabilities the role needs; `image` pins it to Codex
    writes: false          # may the role change project files
    agentArgs:             # extra flags per agent, for example permissions
      claude: ["--permission-mode", "acceptEdits"]
teams:
  docs: [developer, reviewer]
pipeline:
  handoffChars: 4000
```

Role keys: `prompt`, `agent`, `model`, `effort`, `context`, `needs`, `writes`, `agentArgs`. Pipeline key: `handoffChars`.

- `roles.<name>.prompt`: the instructions that define the role (required for a new role).
- `roles.<name>.agent`, `model`, `effort`, `context`: where and how the role runs. They are the role's own; the rules under `rules` do not apply to it.
- `roles.<name>.needs`: capabilities the role needs from its agent. Only `image` exists; such a role runs on Codex only, after a readiness check, and is never moved to Claude.
- `roles.<name>.writes`: `true` if the role may change project files. It documents intent; the permission flags themselves come from `agentArgs`.
- `roles.<name>.agentArgs`: extra command-line arguments per agent, added before the prompt. Roles that write need the agent's permission flags here.
- `teams.<name>`: a list of role names. Teams run in the order architecture, designer, developer, tester, reviewer, security (roles not in that list follow in the order written).
- `pipeline.handoffChars`: the most characters of earlier roles' handoffs given to a role (default 4000).

Validation at load names the key: unknown `agent` or `context`, unknown capability in `needs`, an `image` role pinned to Claude, a team naming an unknown role, or a `handoffChars` that is not a positive integer.

## Environment variables

- `ORCH_HOME`: state directory (default `~/.orch`).
- `ORCH_CONFIG`: path of the config file (default `$ORCH_HOME/config.yaml`).
- `ORCH_DEPTH`: set by orch on the agents it starts. A value of 1 or more makes `orch` refuse to run, which stops an agent from calling orch recursively. Do not set it yourself.
