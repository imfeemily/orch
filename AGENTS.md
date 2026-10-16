# Working on claude-codex-orch

TypeScript (ESM, NodeNext), Node 20+. Read `docs/developer/` before changing behaviour.

## Commands

- `npm test`: all tests (Vitest). Never call the real `claude` or `codex` in tests.
- `npm run build`: type-check and compile to `dist/`.
- `npm run docs:dev` / `npm run docs:build`: documentation site.

## Rules

1. **Test first.** Write a failing test, see it fail, then implement. Bug fixes start with a reproducing test.
2. **Update the docs in the same change.** This is mandatory, not optional:
   - CLI command or flag: `src/cli/usage.ts`, `docs/guide/usage.md`, `docs/th/guide/usage.md`
   - Config key, default or env var: `docs/guide/configuration.md` and the Thai page
   - Failover, cooldown, handoff or routing behaviour: `docs/guide/usage.md`, `docs/developer/architecture.md`, Thai usage page
   - User-visible error text: `docs/guide/troubleshooting.md` and the Thai page
   - Any user-visible change: `CHANGELOG.md` under Unreleased
   `test/docs-coverage.test.ts` fails when commands, config keys or Thai pages are missing. Never edit `docs/reference/` (generated).
3. Keep `src/core` free of daemon, CLI and MCP imports. Pass dependencies in (`Deps`, `RunFn`, `now`).
4. Spawn agents without a shell; the prompt is one argv element after `--`.
5. Imports use the `.js` extension. Commit messages use `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
