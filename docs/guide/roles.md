# Roles

A **role** is a specialised run of an agent: a developer implements, a tester writes tests, a reviewer reviews. Instead of one general call, orch can run a few roles one after another, each with its own instructions, and pass a short summary from role to role.

Roles are opt-in. `orch run "..."` without a role flag behaves exactly as before.

::: info In this release
Built-in roles: `developer`, `tester`, `reviewer`. The `quick` team is `developer`; the `standard` team is `developer`, `tester`, `reviewer`. Architecture, designer and security roles, automatic role selection and parallel read-only roles are planned. You can already define your own roles and teams in the config.
:::

## Ways to run

```bash
orch run --role reviewer "review the last commit"             # one role
orch run --team standard "add a test for clamp() in src/math.ts"   # a named team
orch run --roles developer,tester "fix the bug in parser.ts"  # your own list, in this order
orch run --team standard --dry-run "add a test for clamp()"   # show the plan, spend nothing
```

`--role`, `--roles` and `--team` cannot be combined. The same options exist on the MCP `orch_run` tool (`role`, `roles`, `team`, `dryRun`, `requireCodex`, `keepGoing`).

- **Single role** (`--role`): one call with that role's instructions, agent, model and context. The answer is printed as usual.
- **Team** (`--team`): the team's roles run in a fixed order: architecture, designer, developer, tester, reviewer, security (only those the team contains).
- **List** (`--roles`): the roles run in the order you give.

## What each role does

| Role | Does | Edits project files |
|---|---|---|
| `developer` | Implements the task with the smallest change | yes |
| `tester` | Adds or updates tests (test files only) | yes |
| `reviewer` | Reviews the working-tree changes and reports bugs and risks | no |

Each role is one ordinary orch run, so routing, rate-limit failover, context presets and the usage ledger all apply. After a failover to the other agent the role keeps its context preset and gets that agent's own flags.

## How roles hand work to each other

1. Every role in a team is asked to finish with a `## Handoff` section of at most 150 words.
2. orch saves the role's full answer to `.orch/runs/<run-id>/<role>.md` in the project and keeps the handoff. If a role does not write the section, orch uses the last 1,500 characters of its answer.
3. The next role receives the task plus the earlier handoffs, capped at `pipeline.handoffChars` (4,000 characters by default), newest first.

`.orch/runs/` gets its own `.gitignore` containing `*`, so artifacts stay out of git without touching your `.gitignore`. If the files cannot be written, the run continues without them.

Roles that edit files run one at a time. If a role fails (after failover), the team stops and the remaining roles are reported as `not-run`; add `--keep-going` to continue anyway.

## Roles that need Codex

A role with `needs: [image]` (for example one that makes a mockup or diagram image) runs only on Codex, and only when orch has checked that Codex is ready, without spending any tokens:

- the `codex` command is installed,
- `codex login status` succeeds,
- the `image_generation` feature is enabled in `codex features list`,
- Codex is not cooling down after a rate limit.

Orch checks again just before each such role runs, so a role is also skipped if Codex hit a rate limit during an earlier role. If Codex is not ready, that role is **skipped** with the reason (for example `not logged in: run codex login`) and the other roles continue. Add `--require-codex` to stop before anything runs instead. A role that needs a capability is never moved to Claude, because Claude cannot do the work.

```yaml
roles:
  mockup:
    prompt: "You are a UX designer. Describe and generate a mockup image of the screen in the task."
    needs: [image]
    writes: false
```

Image generation through headless Codex has not been verified end to end in this release: the readiness check and routing work, but check the result of an image role yourself.

## Plan first with `--dry-run`

`--dry-run` prints which roles would run, on which agent, and how many model calls that is. It also shows roles that would be skipped. It spends no tokens.

```text
plan: 3 model calls planned
  developer  claude
  tester     claude
  reviewer   claude
```

## Cost

Several roles mean several calls, and every call loads the agent's fixed context first (see [Benchmarks](/guide/benchmarks)). A `standard` team costs roughly three times one call. The benefit is review and tests, not savings. To keep it down, use only the roles you need, give read-only roles a [context preset](/guide/configuration#context-presets) such as `lean` (the built-in `reviewer` already uses it), and compare with `orch usage --by role`.

## Permissions

`developer` and `tester` are built to edit your project. Headless agents cannot edit files without permission flags, so these roles carry them (Claude `--permission-mode acceptEdits`, Codex `-s workspace-write`) through the role's `agentArgs`. Using these roles lets the agent change files in the directory you run from. Review the result with `git diff`.

## Customizing

Roles and teams are plain config; see [Roles and teams](/guide/configuration#roles-and-teams) for every key and the [defaults reference](/reference/config) for the built-ins.
