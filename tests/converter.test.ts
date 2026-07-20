import assert from "node:assert/strict";
import test from "node:test";

import { convertToTelegramMarkdownV2 } from "../src/converter";

test("converts core inline formatting", () => {
  assert.equal(
    convertToTelegramMarkdownV2("**bold**, *italic*, ***both***, ~~gone~~, ==marked=="),
    "*bold*, _italic_, *_both_*, ~gone~, marked"
  );
});

test("escapes Telegram MarkdownV2 punctuation in plain text", () => {
  assert.equal(
    convertToTelegramMarkdownV2("Price -15%. Use [brackets] and #tags!"),
    "Price \\-15%\\. Use \\[brackets\\] and \\#tags\\!"
  );
});

test("escapes every required MarkdownV2 character exactly once", () => {
  const source = Array.from("_*[]()~`>#+-=|{}.!\\").join(" ");
  const expected = "\\_ \\* \\[ \\] \\( \\) \\~ \\` \\> \\# \\+ \\- \\= \\| \\{ \\} \\. \\! \\\\";

  assert.equal(
    convertToTelegramMarkdownV2(source),
    expected
  );
});

test("does not turn intraword underscores into italic", () => {
  assert.equal(
    convertToTelegramMarkdownV2("foo_bar_baz user_name@example.com"),
    "foo\\_bar\\_baz user\\_name@example\\.com"
  );
});

test("preserves links and converts wikilinks to readable text", () => {
  assert.equal(
    convertToTelegramMarkdownV2("[Obsidian](https://obsidian.md/a_(b)) and [[Folder/Note#Heading|read this]]"),
    "[Obsidian](https://obsidian.md/a_(b\\)) and read this"
  );
});

test("converts headings, lists, tasks, quotes, and tables", () => {
  const source = [
    "# Heading",
    "- [ ] first",
    "  - [x] second",
    "> [!info] Important",
    "> quoted.",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| A | 1 |"
  ].join("\n");

  assert.equal(
    convertToTelegramMarkdownV2(source),
    [
      "*Heading*",
      "• ☐ first",
      "  • ☑ second",
      ">*info: Important*",
      ">quoted\\.",
      "",
      "• *Name* — Value",
      "• A — 1"
    ].join("\n")
  );
});

test("keeps fenced and inline code literal", () => {
  assert.equal(
    convertToTelegramMarkdownV2("`a_b`\n\n```ts\nconst x = `y`;\\n\n```"),
    "`a_b`\n\n```ts\nconst x = \\`y\\`;\\\\n\n```"
  );
});

test("omits YAML frontmatter", () => {
  assert.equal(
    convertToTelegramMarkdownV2("---\ntags: [one, two]\n---\n# Note"),
    "*Note*"
  );
});

test("escapes malformed markup instead of emitting broken entities", () => {
  assert.equal(
    convertToTelegramMarkdownV2("*unfinished [broken](url ~~unfinished"),
    "\\*unfinished \\[broken\\]\\(url \\~\\~unfinished"
  );
});
