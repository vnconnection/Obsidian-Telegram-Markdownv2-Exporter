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
Impact: patch
Rationale: Explain why this impact classification and version bump are correct.

## Summary

One or two sentences describing the user-visible result.

## User-visible changes

- A concrete user-visible change.
```

For a `major` release, append `## Breaking changes` and `## Migration` after
`## User-visible changes`; both sections are required. Do not add them to a
`patch` or `minor` note.

The file name and `Release X.Y.Z` heading must match the tag. The GitHub
Release body must use this authored notes file; generated notes or a generic
body such as `update` are not sufficient.

The note grammar is exact: `Date`, `Impact`, and `Rationale` are single-line
fields in that order, with `Impact` set to `major`, `minor`, or `patch`.
There must be exactly one blank line after the preamble and after every `##`
heading, and exactly one blank line between sections. Headings are unique and
must use `Summary` followed by `User-visible changes`; only major notes may
then contain `Breaking changes` followed by `Migration`, and both are required
for major impact. Every other heading is rejected. `none` and `unknown` are
classifier outcomes for non-publishable or ambiguous changes; release
validation and packaging reject both values before publication using the same
readiness rule.

The classifier maps `feat` to `minor`, `fix` and `perf` to `patch`, and
`docs`, `test`, `tests`, `chore`, `ci`, `build`, `refactor`, and `style` to
`none`. A valid `!` header or terminal non-empty `BREAKING CHANGE:` or
`BREAKING-CHANGE:` footer produces `major`; malformed, empty, non-terminal, or
continued-text breaking footers produce `unknown`. Unknown input wins over
any known impact in a mixed input.

The release classifier accepts a structured wrapper only when each present
`messages`, `commits`, or `commitMessages` field is an array. A string or any
other value in any of those fields is malformed and returns `unknown`; no
present wrapper field is ignored. All present arrays are aggregated in
`commitMessages`, `messages`, `commits` order, so impact precedence is applied
across every supplied message. Release version components are incremented as
exact decimal integers, preserving arbitrarily large `X.Y.Z` components without
`Number`-precision loss.

## Local commands

From a clean branch, inspect the advisory impact and prepare metadata locally:

```bash
npm run release:classify
# Override Git history with JSON or one raw commit message.
npm run release:classify -- --input '[{"header":"fix: escape a delimiter"}]'
npm run release:patch
# or: npm run release:minor
# or: npm run release:major
```

With no `--input`, `release:classify` classifies commits since the latest
version tag (or `HEAD` when no tag exists). `--input` accepts JSON for one
message, an array of messages, or an object containing `messages`, `commits`,
or `commitMessages`; those wrapper fields must be arrays and all present arrays
are aggregated. Invalid JSON is treated as one raw message. Empty or malformed
structured input, or any unknown message among known messages, returns
`unknown` because ambiguity takes precedence over a version bump.

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
validates metadata and required assets, verifies tracked bundle/style provenance
before and after the build, creates the root-layout ZIP, and creates or updates
the GitHub Release using the authored notes file. It publishes only `main.js`,
`manifest.json`, and the ZIP; no stylesheet is expected. Final verification
checks the remote tag target again, published status including `publishedAt`,
the byte-exact authored body, the exact asset set, and downloaded checksums.

Push a commit and tag only after explicit authorization. After the workflow
completes, verify the Release body, asset names and non-zero sizes, then test
installation or update in BRAT and inspect Obsidian DevTools for startup errors.
