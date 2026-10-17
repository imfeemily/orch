# Roles

A **role** is a specialised run of an agent: a developer implements, a tester writes tests, a reviewer reviews. Instead of one general call, orch can run a few roles one after another, each with its own instructions, and pass a short summary from role to role.

Roles are opt-in. `orch run "..."` without a role flag behaves exactly as before.

::: info In this release
Six built-in roles: `architecture`, `designer`, `developer`, `tester`, `reviewer`, `security`. Teams: `quick` (`developer`), `standard` (`developer`, `tester`, `reviewer`) and `full` (all six). Automatic role selection (`--auto`) and image roles on Codex are included. Adjacent read-only roles run in parallel (see below). You can define your own roles and teams in the config.
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
| `architecture` | Describes the design, module boundaries and risks, with a Mermaid diagram when it helps | no |
| `designer` | Creates mockup or diagram images (needs Codex), saved in the run's assets directory | no (only assets) |
| `security` | Reviews the working-tree changes for security problems | no |

Each role is one ordinary orch run, so routing, rate-limit failover, context presets and the usage ledger all apply. After a failover to the other agent the role keeps its context preset and gets that agent's own flags.

## How roles hand work to each other

1. Every role in a team is asked to finish with a `## Handoff` section of at most 150 words.
2. orch saves the role's full answer to `.orch/runs/<run-id>/<role>.md` in the project and keeps the handoff. If a role does not write the section, orch uses the last 1,500 characters of its answer.
3. The next role receives the task plus the earlier handoffs, capped at `pipeline.handoffChars` (4,000 characters by default), newest first.

`.orch/runs/` gets its own `.gitignore` containing `*`, so artifacts stay out of git without touching your `.gitignore`. If the files cannot be written, the run continues without them.

Roles that edit files run one at a time. If a role fails (after failover), the team stops and the remaining roles are reported as `not-run`; add `--keep-going` to continue anyway.

## Parallel read-only roles

Roles that do not change your files (`writes: false`: `architecture`, `designer`, `reviewer`, `security`) run **at the same time** when they are next to each other in the plan, so the built-in `reviewer` and `security` finish together instead of one after the other. A role that edits files (`developer`, `tester`) always runs alone, and nothing runs alongside it.

- Parallel saves **time, not tokens**: every role is still one call, so the cost is the same.
- Roles in a batch all start from the same earlier handoffs and never see each other's. Results, artifacts and the printed answer stay in plan order, whichever call finishes first.
- If one role in a batch fails, its sibling still finishes and is recorded; the team then stops (add `--keep-going` to continue). Cancelling cancels the rest.
- At most `pipeline.maxParallel` roles (default 2) run together, because simultaneous calls use up a rate limit faster. Set `pipeline.parallel: false` or pass `--sequential` to run one role at a time.
- `--dry-run` marks the roles that would run together, for example `reviewer ... (parallel with security)`.

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

Image generation through headless Codex works: in a test it produced a valid PNG at the path it was given. It needs `-s workspace-write`, which the built-in `designer` carries. It is also expensive: one small logo used about 121,000 input tokens of Codex quota (most of it cached) over several tool calls, so run image roles on purpose.

If you pass a [context preset](/guide/configuration#context-presets) that turns off Codex image generation (the built-in `minimal` does), image roles are skipped with that reason instead of running without the capability.

## Images and diagrams

A role with `needs` gets an assets directory, `.orch/runs/<run-id>/assets/`, which orch creates and names at the end of the role's prompt. The role is told to save image and diagram files there and nowhere else. After the role finishes, orch **lists the files that are actually in that directory** and reports them (`orch run` prints an `assets:` section; the MCP result lists them). It does not read file names out of the model's text, so a role that claims a file it did not write is reported as having no files.

The `designer` is allowed to write files (it carries `-s workspace-write`) so that it can save images; only its prompt keeps it out of your project files, so look at `git status` after running it.

Text diagrams do not need Codex: the `architecture` role writes Mermaid in a fenced block in its answer, and that is saved with the role's artifact.

## Automatic selection

`orch run --auto "..."` picks the roles for you with plain keyword rules; it never calls a model, so choosing costs nothing. Turn it on for every run with `auto.enabled: true` in the config, and use `--no-auto` to skip it for one run.

- A **question or explanation** selects **no roles** and runs as one plain call, the cheapest path. That means a prompt ending in a question mark, one that starts with a question word (explain, what, how is, can, should, ...) and has no change verb, or one with a Thai question marker (อธิบาย, ทำไม, อย่างไร, ไหม, ...) and no Thai change word (เพิ่ม, แก้, สร้าง, ...). A polite request to change something ("can you add...", "please fix...") counts as a change.
- Any other task selects `developer`, plus: `tester` for test, bug, fix, regression, feature, implement; `reviewer` for refactor, migrate, implement, feature, or a long prompt; `security` for auth, login, token, password, secret, crypto, sql, upload, permission, payment; `architecture` for architecture, "design the", module, boundary, "api design", migrate; `designer` for ui, ux, screen, layout, mockup, wireframe, diagram, image, logo. Words match whole words, ignoring case, with common endings (tests, fixing, migrated, boundaries). Add your own words under `auto.keywords`; a role you defined yourself can have words there too and is selected last.
- At most `auto.maxRoles` roles run (default 3). When more match, `developer`, `security`, `tester`, `reviewer`, `architecture`, `designer` are kept in that priority, and the ones cut are listed. Selected roles run in the canonical order.
- `--auto` cannot be combined with `--role`, `--roles` or `--team` (an error). With `auto.enabled: true`, an explicit `--role`, `--roles` or `--team` wins for that run, and `--no-auto` turns auto off for it.

```bash
orch explain "implement login with a password reset token"   # which roles, and why; no model call
orch run --auto --dry-run "implement login with a password reset token"
orch run --auto "fix the typo in README"
```

A real auto run prints the selection (`auto: roles developer, tester`) and the reasons on stderr, after the answer. Over MCP the result footer lists `auto=` and, when the limit cut some, `dropped=`.

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
