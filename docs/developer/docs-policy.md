# Documentation policy

**Code and documentation change in the same pull request.** The site is rebuilt and published from `main` on every push, so merged docs are live docs. Several automatic checks keep this honest.

## What to update

| You changed | Update |
|---|---|
| A CLI command or flag | `USAGE` in `src/cli/usage.ts`, `docs/guide/usage.md` and `docs/th/guide/usage.md` |
| A config key, default or env var | `docs/guide/configuration.md` and the Thai page; defaults are generated for you |
| Failover, cooldown, handoff or routing behaviour | `docs/guide/usage.md` ("How a task runs"), `docs/developer/architecture.md`, Thai usage page |
| An error message users see | `docs/guide/troubleshooting.md` and the Thai page |
| Module layout or protocol | `docs/developer/architecture.md` |
| Build, test or release steps | `docs/developer/setup.md`, `testing.md` or `release.md` |
| Anything user-visible | `CHANGELOG.md` under "Unreleased" |

## What is automatic

- **Reference pages are generated.** `docs/reference/config.md` (built-in defaults) and `cli.md` are produced from `DEFAULT_CONFIG` and `USAGE` by `scripts/gen-reference.ts` during every docs build. They are git-ignored and cannot drift.
- **Docs coverage tests** (`test/docs-coverage.test.ts`) fail `npm test` when a CLI command, config key or environment variable is missing from the guide, or when an English guide page has no Thai counterpart.
- **CI docs gate.** A pull request that changes `src/` must also change `docs/` or `CHANGELOG.md`. For a change that really needs no docs (an internal refactor), write `docs: n/a` in the pull request description.
- **PR template.** Every pull request starts with a documentation checklist.
- **Contributor instructions for AI agents.** `AGENTS.md` and `CLAUDE.md` tell Codex and Claude Code to update docs with their code changes.
- **Deployment.** `.github/workflows/pages.yml` runs the tests, builds the site and deploys it to GitHub Pages on every push to `main`.

## Writing guidelines

- Lead with what the reader does. Show the command first and explain after.
- English is the source of truth for the developer guide and reference. User guide pages exist in English and Thai; update both in the same change.
- Document behaviour, not code structure, in the guide. Put structure in the architecture page.
- Use the real error text users will see so that search finds it.
- Never edit `docs/reference/`; change the code or the generator instead.

## Adding a page

1. Create the Markdown file under `docs/` (and its Thai twin under `docs/th/` for guide pages).
2. Add it to the sidebar in `docs/.vitepress/config.ts`.
3. Run `npm run docs:build`. Dead links fail the build.
