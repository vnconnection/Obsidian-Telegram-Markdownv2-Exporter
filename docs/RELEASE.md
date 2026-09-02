# Release

## Release contract

The plugin id is `telegram-markdownv2-exporter`. `package.json`,
`package-lock.json`, `manifest.json`, `versions.json`, and the bare Git tag must
agree on one `X.Y.Z` version. `versions.json` maps that version to the minimum
supported Obsidian version (`1.5.0` for the current project).

The GitHub Release used by BRAT must expose these non-empty assets at its root:

- `main.js`
- `manifest.json`

This plugin does not build or use `styles.css`; a stylesheet is not a required
release asset. The optional ZIP must contain exactly those two files directly at
its archive root. A Git tag existing on GitHub does not prove that the Release
has the assets BRAT needs.

## Release notes

Every published version must have a dedicated `docs/releases/<X.Y.Z>.md` file
before its version tag is created. Use this structure and keep only applicable
sections:

```markdown
# Release X.Y.Z

Date: YYYY-MM-DD

## Summary

One or two sentences describing the user-visible result.

## Impact

`patch` — state the backward-compatible user impact.

## Rationale

Explain why this impact classification and version bump are correct.

## Added

- A concrete user-visible addition.

## Changed

- A concrete user-visible behavior change.

## Fixed

- A concrete user-visible bug fix.

## Breaking changes

- Required for a breaking release, with migration instructions.

## Migration

- Required for a major release; describe the steps existing users must take.

## Documentation

- A concrete user-facing documentation change.
```

The file name and `Release X.Y.Z` heading must match the tag. The GitHub
Release body must use this authored notes file; generated notes or a generic
body such as `update` are not sufficient.

## Local commands

From a clean branch, inspect the advisory impact and prepare metadata locally:

```bash
npm run release:classify
npm run release:patch
# or: npm run release:minor
# or: npm run release:major
```

`release:prepare` requires an explicit impact and updates version metadata only;
it does not commit, create a tag, push, create a GitHub Release, or upload
assets. Add and review the matching authored notes before committing.

Validate or package an already selected version without publishing:

```bash
npm run release:validate -- <X.Y.Z>
npm run release:package -- <X.Y.Z> artifacts/telegram-markdownv2-exporter-<X.Y.Z>.zip
```

The complete local gates are:

```bash
npm run typecheck
npm test
node --test release.test.mjs
npm run build
npm run release:validate -- <X.Y.Z>
```

## GitHub Actions flow

`.github/workflows/release.yml` runs for an exact bare `X.Y.Z` tag, checks out
that tag, installs with `npm ci`, runs the quality gates and release tests,
validates metadata and required assets, creates the root-layout ZIP, and creates
or updates the GitHub Release using the authored notes file. It publishes only
`main.js`, `manifest.json`, and the ZIP; no stylesheet is expected.

Push a commit and tag only after explicit authorization. After the workflow
completes, verify the Release body, asset names and non-zero sizes, then test
installation or update in BRAT and inspect Obsidian DevTools for startup errors.
