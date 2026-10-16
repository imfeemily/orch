# Conventions

## Code

- TypeScript with `strict`, ESM (`"type": "module"`, NodeNext). Import local files with the `.js` extension.
- Keep `src/core` free of transport concerns. It must not import from `daemon`, `cli` or `mcp`.
- Dependencies come in through parameters (`Deps`, `RunFn`, `now`) so behaviour is testable without spawning processes or waiting on clocks.
- Spawn agents without a shell and pass the prompt as a single argument.
- Anything that varies between CLI releases belongs in config, not code: flags, error patterns, cooldowns.
- Prefer returning a `TaskResult` with a `status` over throwing for expected failures. Throw only for programmer or configuration errors, and make the message say how to fix it.
- Keep dependencies minimal. Runtime: `yaml`, `zod`, `@modelcontextprotocol/sdk`.

## Tests

- Test first, one behaviour per test, named after the behaviour.
- No real `claude` or `codex` in automated tests.
- Use real temp directories and repositories instead of mocking the filesystem or git.

## Commits and branches

- One branch per change, merged into `main` when `npm test` and `npm run build` pass.
- Commit messages use a type prefix: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Each commit should leave the tests green.

## Documentation

Code and docs change together. See [Documentation policy](/developer/docs-policy).

## Extending

**A new config key**

1. Add it to the types in `src/core/types.ts` and, if it has a default, to `DEFAULT_CONFIG`.
2. Validate it in `src/core/config.ts` and add tests in `config.test.ts`.
3. Document it in `docs/guide/configuration.md` and `docs/th/guide/configuration.md`. `docs-coverage.test.ts` enforces this for agent and rule keys.

**A new CLI command**

1. Add it to `parseArgs` (`src/cli/args.ts`) with a test, to `USAGE` (`src/cli/usage.ts`), and to the switch in `src/cli/index.ts`.
2. Document it in both `guide/usage.md` pages. The coverage test fails until you do.

**A new rate-limit or login pattern**

Add the regex to `LIMIT_PATTERNS` or `AUTH_PATTERNS` in `src/core/config.ts` and a case to `detector.test.ts` using the real message. Users can also add patterns in their own config.

**A third agent**

Not supported yet: `AgentName` has two members and `otherAgent` assumes exactly two. Adding one means generalizing the failover choice in `src/core/router.ts` and `orchestrator.ts` first.
