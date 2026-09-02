# Telegram MarkdownV2 Exporter

Obsidian plugin that copies the current Markdown note to the clipboard as Telegram MarkdownV2. Use the ribbon clipboard icon or the command `Copy current note as Telegram MarkdownV2`, then paste the result into Telegram's Rich Text Editor.

## What is converted

- Headings become bold lines because `#` is not a heading marker in Telegram MarkdownV2.
- Obsidian bold, italic, bold+italic, and strikethrough become Telegram bold, italic, bold+italic, and strikethrough.
- Links keep their destination; wikilinks and embeds become readable text because they have no vault-local meaning in Telegram.
- Lists become readable bullet/numbered lines; task markers become `☐`, `☑`, or `☒`.
- Quotes and Obsidian callouts become Telegram blockquotes. Callout collapse state and callout styling are flattened.
- Tables become readable bullet rows because MarkdownV2 has no table syntax.
- Inline code and fenced code are kept as code, with Telegram's code escaping applied.
- YAML frontmatter and Obsidian comments are omitted from the exported message.

Unsupported visual semantics such as highlights and arbitrary HTML are flattened to their text. The exporter does not access the network, change the note, or send anything to Telegram; it only reads the active note and writes the converted text to the clipboard.

## Development

```bash
npm install
npm run check
node --test release.test.mjs
```

`npm run build` produces the BRAT asset `main.js`.

## BRAT release

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), choose `BRAT: Add a beta plugin for testing`, and enter `ssfxate/telegram-markdownv2-exporter`. BRAT installs `main.js`, `manifest.json`, and the matching tagged GitHub Release.

This plugin has no `styles.css` build output, so BRAT releases require only
non-empty `main.js` and `manifest.json`; the optional ZIP contains those two
files at its root.

The local release flow is:

```bash
npm run release:classify
# Supply commit messages directly as JSON or as one raw message.
npm run release:classify -- --input '[{"header":"fix: escape a delimiter"}]'
npm run release:patch
# or npm run release:minor / npm run release:major
npm run release:validate -- <X.Y.Z>
npm run release:package -- <X.Y.Z> artifacts/telegram-markdownv2-exporter-<X.Y.Z>.zip
```

`release:classify` reads Git history when no input is supplied. `--input`
overrides history; valid JSON may be a message, an array, or an object with a
`messages`, `commits`, or `commitMessages` array. When multiple wrapper fields
are present, every one must be an array; a string or another value in any
wrapper field is malformed structured input. All present arrays are aggregated
in `commitMessages`, `messages`, `commits` order, so impact precedence is
evaluated across every supplied message. Non-JSON input is treated as one raw
commit message. Empty or malformed structured input, and any unknown message
mixed with known messages, classify as `unknown`.

Version components are incremented as exact decimal integers, so the release
preparation script does not lose precision for arbitrarily large `X.Y.Z`
components.

Preparation updates local version metadata only. It does not commit, create a
tag, push, create a GitHub Release, or upload assets. Before creating a bare
`X.Y.Z` tag, add the matching authored notes at `docs/releases/<X.Y.Z>.md` and
run the validation commands documented in [docs/RELEASE.md](docs/RELEASE.md).
GitHub Actions then publishes the authored notes body plus `main.js`,
`manifest.json`, and the root-layout ZIP after the tag is pushed.
Authored notes must use exact `Date`, `Impact`, and `Rationale` fields plus
non-empty `Summary` and `User-visible changes` sections. The `##` headings
must be canonical, unique, and ordered as documented; use exactly one blank
line after the preamble and after each section heading, with one blank line
between sections. Major releases additionally require `Breaking changes` and
`Migration` sections.

## Format references

The conversion rules follow Telegram's [MarkdownV2 formatting options](https://core.telegram.org/bots/api#formatting-options) and the Obsidian [basic](https://obsidian.md/help/syntax) and [advanced](https://obsidian.md/help/advanced-syntax) Markdown syntax pages. Telegram's [Rich Text Editor announcement](https://telegram.org/blog/communities-editor-invisible-messages#rich-text-editor) confirms the target editor, but does not specify that arbitrary clipboard Markdown is parsed automatically. This plugin therefore emits strict MarkdownV2 and does not claim to reproduce Telegram's separate Rich Markdown format.
