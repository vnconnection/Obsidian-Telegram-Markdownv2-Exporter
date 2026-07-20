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
```

`npm run build` produces the BRAT asset `main.js`.

## BRAT release

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), choose `BRAT: Add a beta plugin for testing`, and enter `ssfxate/telegram-markdownv2-exporter`. BRAT installs `main.js`, `manifest.json`, and the matching tagged GitHub Release.

The release flow is:

```bash
npm run release:patch
```

Before publishing, the release script expects the repository to be authenticated to the personal `ssfxate` GitHub account and publishes `main.js` and `manifest.json` as release assets.

## Format references

The conversion rules follow Telegram's [MarkdownV2 formatting options](https://core.telegram.org/bots/api#formatting-options) and the Obsidian [basic](https://obsidian.md/help/syntax) and [advanced](https://obsidian.md/help/advanced-syntax) Markdown syntax pages. Telegram's [Rich Text Editor announcement](https://telegram.org/blog/communities-editor-invisible-messages#rich-text-editor) confirms the target editor, but does not specify that arbitrary clipboard Markdown is parsed automatically. This plugin therefore emits strict MarkdownV2 and does not claim to reproduce Telegram's separate Rich Markdown format.
