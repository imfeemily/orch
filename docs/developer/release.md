# Releasing

The package is published to npm as `claude-codex-orch`; the commands are `orch` and `orch-mcp`.

## Checklist

1. On a clean `main`, run `npm test` and `npm run build`. Both must pass.
2. Update `CHANGELOG.md`: move the entries under a new version heading with today's date.
3. Bump `version` in `package.json`. Use a minor bump for new features and a patch bump for fixes.
4. Run `npm pack --dry-run` and check that only `dist/`, `config.example.yaml`, `README.md` and `LICENSE` are listed.
5. Optional: install the tarball into a temporary prefix and run `orch init` and `orch status` against a throwaway `ORCH_HOME`.
6. Commit as `chore: release X.Y.Z` and tag `vX.Y.Z`.
7. Publish: `npm publish`.
8. Push `main` and the tag. The Pages workflow redeploys the docs.

## Publishing notes

- npm requires two-factor authentication to publish. Log in with `npm login`, or use a granular access token set up for publishing, and enter the one-time password when asked.
- The `prepack` script rebuilds `dist/` so the tarball is never stale; `prepublishOnly` runs the tests.
- The first publish of a name creates a `0.0.0-stage` placeholder on the Packages page; the real version appears after the publish completes.
- Verify the release: `npm view claude-codex-orch version`, then `npm install -g claude-codex-orch && orch init && orch status` on another machine.

## After a release

- Confirm the docs site shows the new changelog entry.
- Users update with `npm install -g claude-codex-orch@latest` and then `orch daemon stop` so the new code runs.
