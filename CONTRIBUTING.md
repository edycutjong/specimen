# Contributing

1. `npm ci`
2. `npm run typecheck && npm test` must pass.
3. Keep jars and replays honest: never hand-edit a recorded jar; record a new one.
4. Small commits with real messages.

## Releases

Versions are cut by `.github/workflows/release.yml`, only after `CI` is green on `main`, and always on the commit that CI run
judged. The bump comes from the commit subjects since the last tag, in the Angular convention (the rules live in
`.github/scripts/next-version.sh`, which also runs locally as a dry run: `bash .github/scripts/next-version.sh`):

| Commit subject | Bump |
|---|---|
| `fix: ...`, `perf: ...` | patch (`0.1.0` to `0.1.1`) |
| `feat: ...` | minor (`0.1.1` to `0.2.0`) |
| any type with `!` (`feat!: ...`), or a `BREAKING CHANGE:` footer | major; while the version is `0.x`, minor |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `style:`, `build:`, `revert:`, or no type at all | no release |

Authorship prefixes are allowed in front of the type and are ignored when the bump is computed: `[kiro] `,
`[claude-direct] `, `kiro: ` and `claude-direct: ` (`claude-direct: fix(landing): ...` is a patch, `kiro: docs: ...` is none). A prefix with no type after it cuts nothing.

Automatic cuts happen only while the repository variable `AUTO_RELEASE` is `true`; otherwise the run reports what it would
cut, and the owner can cut by hand (Actions > Release > Run workflow, with an optional dry run). After every run the workflow
keeps the README's release badge (`docs/badges/release.svg`) on the latest release, committing it as
`chore(release): badge vX.Y.Z`.

By contributing you agree your work is released under the MIT license.
