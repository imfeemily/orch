# Development setup

## Requirements

- Node.js 20 or newer (CI uses 22)
- git
- Optional: `claude` and `codex`, only for manual smoke tests

## Get started

```bash
git clone <repo-url> orch && cd orch
npm install
npm test                 # unit and integration tests, no real CLIs needed
npm run build            # tsc to dist/
npm link                 # puts `orch` and `orch-mcp` on your PATH
```

Always point a development build at a throwaway state directory so it does not touch your real cooldowns:

```bash
export ORCH_HOME="$(mktemp -d)"
orch init && orch status
orch daemon stop         # after rebuilding, stop the old daemon
```

`npm link` runs the built code in `dist/`, so rebuild after changes. Tests run the TypeScript sources directly through Vitest.

## Documentation site

```bash
npm run docs:dev         # generates docs/reference/*, then serves with hot reload
npm run docs:build       # production build into docs/.vitepress/dist
npm run docs:preview     # serve the built site
```

`docs/reference/` is generated from the code and ignored by git; never edit it by hand. See [Documentation policy](/developer/docs-policy).

## Repository layout

```
src/        core, daemon, cli, mcp
test/       Vitest tests and helpers (fake agent, config builders)
scripts/    docs reference generator
docs/       this site (VitePress), en at /, th at /th/
.github/    CI, Pages deployment, PR template
```

## Gotchas

- Imports use the `.js` extension even though the files are `.ts` (NodeNext ESM).
- `tsconfig.json` lists `"types": ["node"]` explicitly; TypeScript 7 does not find `@types/node` otherwise.
- Unix socket paths are limited to about 104 characters on macOS, so tests create short temp directories.
- Codex refuses to run outside a trusted git directory; run smoke tests inside a repository.
