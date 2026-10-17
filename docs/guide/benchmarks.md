# Benchmarks: where orch saves tokens

These are real runs of the real `claude` and `codex` on one machine, measured on 2026-10-17. They show **which orch features reduce cost, by how much, and which do not**. Raw data is in `benchmarks/results-2026-10-17.json`, `-handoff-repeat.json`, `-context.json`, `-roles.json` and `-roles2.json` (all in `benchmarks/`); the harness is `scripts/benchmark.ts`.

::: warning Read the limits first
Few runs, one machine, one small repository, three small tasks. Treat the numbers as a direction, not statistics. Identical runs differ a lot (see [Noise](#noise-the-same-task-varied-by-38)), so only differences much bigger than about 40% mean something.
:::

## Summary

| Where the saving comes from | Measured effect | Confidence |
|---|---|---|
| **Model routing**: small tasks to `haiku` with low effort instead of the default `claude-sonnet-5` | **-76% cost** on 3 tasks (-64% to -78% each); tokens only -27% | Good: far larger than the noise; 3 of 3 tasks still correct |
| **Slimmer handoff**: `git diff --stat` instead of an inlined diff (large diffs only) | **about -5,700 to -7,300 input tokens per model call** of the receiving agent (-20% to -25% per call) on a 60,000-character diff | Medium: clean in single-call runs, hidden by noise in whole-run totals |
| **Skipping the summary call** after a limit or login failure | Saves time, **not tokens** (a call to a limited agent should fail immediately; not measured) | Reasoning only |
| orch itself | **No measurable overhead** (+0.7% tokens, +5.8% cost, within noise); orch makes no LLM calls of its own | Good |
| **Context presets** (`--context lean`): skip user-level hooks, plugins and skills | **-48% cost** across the same 3 tasks with the default model (-41% against every default run in this study), all correct; Codex **-18% input per call** | Medium: consistent direction, but one run per task and about ±30% noise |
| **Roles** (`--team standard`: developer, tester, reviewer) | **Costs more, by design:** 2.5x the tokens, 2.8x the cost and 3.7x the time of one plain call on a small task; all three roles succeeded | Medium: one task, one run |
| **Image role** (`--role designer` on Codex) | A valid SVG mockup in 23 s; **21,200 billable tokens** (19,989 input + 1,211 output, plus 110,592 cached input) | Medium: one run |
| **Auto selection** (`--auto`) | Chose `developer` and `tester` for a small test task: **2 calls, $0.5889** against $0.8078 for the 3-role team and $0.2931 for one call | Medium: one run |
| **Fixed context per call** if you do nothing | Not reduced by default: 44% to 86% of the cost of a small task. `--safe-mode` (preset `minimal`) cuts a one-word call by 68% but also drops project instructions | Good |

The key point: **orch saves money mainly by choosing a cheaper model for small tasks, not by sending fewer tokens.** Token counts barely moved (-27%), cost fell by three quarters because a token on `haiku` is much cheaper than a token on `sonnet`.

## Method

- orch from the repository at commit `826c5b5`, Claude Code 2.1.231, Codex 0.162.1, Node 24, macOS.
- A small seeded git repository (README, three source files), copied fresh for every run.
- Claude ran with `--permission-mode acceptEdits` so it can edit in headless mode. Codex used `gpt-6-luna` with low effort.
- Tokens are *billable tokens* as `orch usage` counts them: input excluding cache reads, plus output. **Cost is the better comparison** because it prices each model and cache read correctly (Claude reports it; Codex does not).
- Each run records whether the result was correct (file edited, test file created, answer right).

## Experiment A: model routing

Three tasks. Baseline: `claude -p` with the default model. Routed: through orch with this rule.

```yaml
rules:
  - match: "spelling|explain|vitest"
    agent: claude
    model: haiku
    effort: low
```

| Task | Default model | Routed to haiku (low) | Cost change | Tokens change | Correct |
|---|---|---|---|---|---|
| Fix a typo | 66,548 tokens, $0.4242 | 43,827 tokens, $0.0941 | **-78%** | -34% | yes / yes |
| Write a small test | 42,113 tokens, $0.2906 | 26,065 tokens, $0.0627 | **-78%** | -38% | yes / yes |
| Explain a function | 21,023 tokens, $0.1504 | 24,369 tokens, $0.0537 | **-64%** | +16% | yes / yes |
| **All three** | **129,684 tokens, $0.8652** | **94,261 tokens, $0.2105** | **-76%** | **-27%** | 3/3 / 3/3 |

Notes:

- The first automatic check marked the default-model *explain* answer wrong because it wrote `<` instead of the word "below". The answer was correct; I verified it by reading and corrected the record (the raw file notes this).
- For the typo task the baseline was measured twice: $0.4242 (first run) and $0.2952 (repeat, see Experiment B). Against the cheaper repeat the saving is still **-68%**.
- Token savings are small and one task used more tokens. The cost saving is the model price.
- The test-creation task needed the model to write a file, and `haiku` did it correctly here. That does not mean it will on harder work: keep model rules for small, well-defined tasks and leave refactors and design work on the stronger model.

## Experiment B: does orch add overhead?

The same typo task, same model, run directly and through orch (no routing rule).

| Run | Tokens | Cost |
|---|---|---|
| Direct `claude -p` | 41,200 | $0.2952 |
| Through orch | 41,492 | $0.3122 |
| Difference | +0.7% | +5.8% |

The gap is inside the noise below. orch only chooses an agent and parses the output; it never calls a model itself, so it adds no tokens by design.

### Noise: the same task varied by 38%

The same task and settings, run twice directly: **66,548 tokens ($0.4242)** the first time and **41,200 tokens ($0.2952)** the second. The difference is the prompt cache: a cold cache re-creates the large fixed context, a warm one reads it cheaply, and the number of model turns also varies. So a single-run difference smaller than roughly 40% in tokens or 30% in cost is not meaningful.

## Experiment C: handoff after a failover

The receiving agent (Codex) continues after a failover, in a repository with a 60,269-character uncommitted diff. Old handoff: the diff up to 20,000 characters plus a summary from the first agent. New handoff: `git diff --stat` and no summary.

| | Old handoff | New handoff |
|---|---|---|
| Prompt size | 20,781 characters | 614 characters (-97%) |
| Input tokens per model call | 28,655 | 21,400 to 22,900 (**-5,700 to -7,300, -20% to -25%**) |
| Total input over 5 whole runs (mean) | 46,250 | 42,576 (-8%, not significant) |
| Correct | 5/5 | 5/5 |

The per-call figure is the whole-run input divided by the number of model calls Codex made (one or two). The old prompt gave 28,655 per call every time; the new one gave 21,397 to 22,943. Whole-run totals are noisy because Codex sometimes made two calls and sometimes one, which is a bigger effect than the prompt size. The honest reading: the slim handoff removes roughly 5,700 to 7,300 tokens from **every** model call the receiving agent makes after a large-diff failover; a small diff is unchanged because it is still inlined (4,000 characters or less).

**The summary call** that the old handoff made for a plain failure cost 22,879 tokens and $0.1460, and took 7 seconds (Claude resuming the previous session). The current handoff still requests it after a *plain* failure and skips it after a rate limit or login failure. After a limit the call should fail at once and cost almost nothing, so the saving there is time, not tokens (not measured). If you do not want the extra ~23,000 tokens per plain-failure failover, remove `summaryArgs` from the agent in your config.

## Experiment D: the fixed cost of every call

A one-word answer ("reply with the word pong") shows what each call costs before any real work.

| Run | Tokens | Cost |
|---|---|---|
| Claude, default context | 20,381 | $0.1300 |
| Claude `--safe-mode` (no CLAUDE.md, skills, plugins, hooks, MCP) | 5,611 | $0.0412 (**-68%**) |
| Claude `--disable-slash-commands` | 36,161 | $0.2170 (cold cache, not comparable) |
| Claude `--bare` | failed | needs an API key; not logged in with OAuth |
| Codex, default context | 9,515 (+12,544 cached) | not reported |

On this machine a one-word answer costs $0.13 on Claude (an earlier cold-cache measurement was $0.27). That is **44% of the typo task's repeat cost and 86% of the explain task's cost**: for small tasks, most of the bill is the context loaded on every call, which orch does not reduce. `--safe-mode` shows the size of the opportunity, but it also removes your project instructions and tools, so it changes behaviour and is not a free win.

## Experiment E: context presets

The same three tasks with the default model, through orch, with the default context and with `--context lean` (see [Context presets](/guide/configuration#context-presets)). The order alternated between tasks and each variant's cache was warmed first.

| Task | Default context | `--context lean` | Cost change | Total input change | Correct |
|---|---|---|---|---|---|
| Fix a typo | 66,883 tokens, $0.4418 | 41,700 tokens, $0.2803 | **-37%** | -28% | yes / yes |
| Write a small test | 43,107 tokens, $0.3154 | 17,552 tokens, $0.1369 | **-57%** | -46% | yes / yes |
| Explain a function | 40,667 tokens, $0.2621 | 16,246 tokens, $0.1140 | **-56%** | -28% | yes / yes |
| **All three** | **150,657 tokens, $1.0193** | **75,498 tokens, $0.5312** | **-48%** | **-35%** | 3/3 / 3/3 |

"Total input" counts cache reads too (it is what the model actually received).

**Reading it honestly.** The direction is the same in all three tasks, but each cell is one run and the default-context cost itself varies about ±30% from run to run: the typo task cost $0.4242, $0.2952 and $0.4418 in three default runs. Against every default run of these tasks in this study the saving is **-41%**, and per task it ranges from -5% to -57% depending on which baseline you pick. The one-word probes agree: `--setting-sources project` alone cut cost by 47% and `lean`-style combinations by 58%. So expect roughly **40% to 50%**, not an exact number.

**Codex** (one-word answer through orch, `gpt-6-luna`, low effort): total input per call went from 22,066 and 21,280 (default) to 17,862 and 17,862 (`lean`), about **-18%**. Codex's own base context is smaller and less compressible than Claude's.

What `lean` gives up: user-level settings, hooks, plugins and personal instructions. These tasks did not depend on any of them. Check your own: if a task needs a user-level permission or hook, put it in the agent's `args` or the project's settings.

## Experiment F: roles

The "write a small test" task as one plain call and as `orch run --team standard` (developer, tester, reviewer, each a separate call with the built-in role prompts and permission flags).

| Run | Tokens | Cost | Time | Correct |
|---|---|---|---|---|
| One plain call | 42,319 | $0.2931 | 20 s | yes |
| `--team standard` | 106,420 | $0.8078 | 74 s | yes (all three roles succeeded) |
| **Team vs plain** | **2.5x** | **2.8x** | **3.7x** | |

Per role: developer 42,744 tokens ($0.2973), tester 41,688 ($0.2698), reviewer 21,988 ($0.2407). The reviewer used the `lean` context, but it was the first call with those flags in this run, so its cache was cold and its cost is higher than a warm `lean` call would be.

What the extra calls bought: the reviewer checked the generated test against the implementation, including the boundary cases of `clamp` (strict `<` and `>`), found no bugs, and noted that the project had no `vitest` dependency, so running the tests would need a download. Each role's full answer was saved under `.orch/runs/<run-id>/` (with a `.gitignore` of `*`).

**Reading it honestly.** On a task this small, three roles cost about three times one call and mostly confirm what one call already did. Roles earn their cost on changes that deserve a second look: larger edits, risky areas, code you will not read line by line. For small edits, use one call (and a model and context preset from the experiments above). One run of one task: treat the multiple as a rough guide.

## Experiment G: the image role and auto selection

**The designer on Codex.** `orch run --role designer "Design a simple login screen mockup..."` created `login-screen-mockup.svg` (1,995 bytes, a valid SVG with a title, a centred form, email and password fields and a Sign in button) under `.orch/runs/<run-id>/assets/`, and `orch run` listed it under `assets:`. It took 23 seconds and 21,200 billable tokens (19,989 input, 1,211 output) with another 110,592 input tokens read from cache. The earlier probe that asked for a PNG logo drew with Pillow and used about 121,000 input tokens in total, so expect roughly 100,000 to 130,000 input tokens (mostly cached) per image role on this machine. Codex chose the format (SVG here, PNG in the probe); ask for a format in your role prompt if it matters.

**Auto selection.** `orch run --auto` on the "write a small test" task chose `developer` and `tester` (the word `test`), spending 84,989 tokens and $0.5889 (developer $0.2927, tester $0.2962) in 40 seconds, and the test file was created. For the same task one plain call cost $0.2931 and the `standard` team (three roles) $0.8078. Auto did not add a reviewer because the prompt had no word that asks for one. As with any team, the extra role roughly doubled the cost of the plain call.

Limits: one run each. The image result is the model's drawing, not a measure of design quality.

## What to do with this

1. **Add model rules for small tasks.** This is the saving that measured clearly. Start with typo, rename, explain and small-test rules (see [Configuration](/guide/configuration)), check `orch usage --by model`, and widen only if results stay correct.
2. **Leave the handoff defaults.** They help most when a failover happens with a large uncommitted change.
3. **Consider removing `summaryArgs`** if failovers after plain failures are frequent and cost matters more than the extra context.
4. **Use a context preset for small tasks.** Add `context: lean` to your small-task rules next to the model rule (Experiment E). Heavy user-level hooks, plugins and skills are loaded into every call orch makes for you; `lean` skips them while keeping the project's own instructions.
5. **Use roles for changes worth a second look**, not for small edits: a three-role team cost about 2.8 times one call here. Start with `--dry-run` to see the number of calls, and `orch usage --by role` to see where the cost went.
6. **Do not trust single runs.** Use `orch usage` over days, not one comparison.

## Limits of this study

- Few runs and one machine: results vary with account, plan, cache state and CLI version.
- Savings from model routing depend on your default model. If your default is already `haiku`, routing saves nothing.
- Three small tasks. Quality on harder tasks was not tested, and a cheaper model that needs a retry costs more. The same applies to `lean`: a task that needs your user-level hooks or skills will behave differently.
- Codex cost in dollars is not reported by the CLI, so Experiment C uses tokens only.
- Not measured: the value of avoiding a mid-task rate limit, which needs the quota-aware routing planned for a later stage.

## Reproduce

```bash
npm run build
npm run benchmark                                  # all experiments, real tokens, a few dollars
npm run benchmark -- --only A,B                    # a subset
npm run benchmark -- --only E                      # context presets
npm run benchmark -- --only F                      # roles: one call against a team
npm run benchmark -- --only G                      # the image role and auto selection
npm run benchmark -- --only C --c-repeats 4 --skip-summary --out benchmarks/my-run.json
```

The script runs in temporary copies of a seeded repository and writes one JSON record per run (tokens, cost, models, duration, whether the result was correct).
