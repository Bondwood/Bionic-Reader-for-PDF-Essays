# Versioning & releases

This project uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

The single source of truth for the extension version is `manifest.json`
(`"version"`). `CHANGELOG.md` documents what changed in each release, and each
release is tagged in git as `v<MAJOR.MINOR.PATCH>`.

## Releasing a new version

1. Decide the next version number using SemVer:
   - `PATCH` — backwards-compatible bug fixes.
   - `MINOR` — new backwards-compatible functionality.
   - `MAJOR` — breaking changes.
2. Update `"version"` in `manifest.json`.
3. Add an entry to `CHANGELOG.md` under a new `## [<version>] - <date>`
   heading (moving prior work out of `[Unreleased]`).
4. Run the test suite to confirm a green build:
   ```powershell
   node --test tests/*.test.js
   ```
5. Commit the changes:
   ```
   git add manifest.json CHANGELOG.md
   git commit -m "Release v<version>"
   ``
6. Tag and (optionally) push:
   ```
   git tag v<version>
   git push origin main --tags   # adjust remote/branch as needed
   ``

Keep `[Unreleased]` at the top of `CHANGELOG.md` for work-in-progress changes;
move its contents into the release entry at step 3.
