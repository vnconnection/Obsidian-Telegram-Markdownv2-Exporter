"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TelegramMarkdownV2ExporterPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/converter.ts
var TELEGRAM_SPECIAL_CHARACTERS = new Set(
  Array.from("_*[]()~`>#+-=|{}.!\\")
);
var HTML_MARKERS = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  u: "underline",
  ins: "underline",
  s: "strike",
  strike: "strike",
  del: "strike"
};
function escapeTelegramText(text) {
  let result = "";
  for (const character of text) {
    if (TELEGRAM_SPECIAL_CHARACTERS.has(character)) {
      result += `\\${character}`;
    } else {
      result += character;
    }
  }
  return result;
}
function escapeTelegramCode(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}
function findUnescaped(text, needle, from) {
  for (let index = from; index <= text.length - needle.length; index += 1) {
    if (text.startsWith(needle, index) && (index === 0 || text[index - 1] !== "\\")) {
      return index;
    }
  }
  return -1;
}
function isWordCharacter(character) {
  return character ? /^[\p{L}\p{N}_]$/u.test(character) : false;
}
function canOpenFormatting(text, index, delimiter) {
  if (delimiter.length === 1 && isWordCharacter(text[index - 1]) && isWordCharacter(text[index + 1])) {
    return false;
  }
  return true;
}
function canCloseFormatting(text, index, delimiter) {
  if (delimiter.length === 1 && isWordCharacter(text[index - 1]) && isWordCharacter(text[index + delimiter.length])) {
    return false;
  }
  return true;
}
function findFormattingEnd(text, delimiter, from) {
  let searchFrom = from;
  while (searchFrom <= text.length - delimiter.length) {
    const end = findUnescaped(text, delimiter, searchFrom);
    if (end < 0 || canCloseFormatting(text, end, delimiter)) {
      return end;
    }
    searchFrom = end + delimiter.length;
  }
  return -1;
}
function findClosingBracket(text, from) {
  return findUnescaped(text, "]", from);
}
function findLinkEnd(text, openParenthesis) {
  let depth = 0;
  for (let index = openParenthesis; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === "(") {
      depth += 1;
    } else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}
function getLinkDestination(rawDestination) {
  const destination = rawDestination.trim();
  if (destination.startsWith("<")) {
    const closingAngle = destination.indexOf(">");
    if (closingAngle >= 0) {
      return destination.slice(1, closingAngle);
    }
  }
  return destination.split(/\s+/u, 1)[0] ?? "";
}
function escapeLinkDestination(rawDestination) {
  return getLinkDestination(rawDestination).replaceAll("\\", "\\\\").replaceAll(")", "\\)").replaceAll(" ", "%20");
}
function getWikilinkLabel(rawTarget) {
  const aliasParts = rawTarget.split("|");
  const alias = aliasParts.length > 1 ? aliasParts.at(-1) ?? "" : "";
  if (alias.trim()) {
    return alias.trim();
  }
  const target = aliasParts[0] ?? "";
  const withoutSubpath = target.split("#", 1)[0].split("^", 1)[0];
  return withoutSubpath.split("/").at(-1)?.trim() ?? "";
}
function convertHtmlTag(text, index) {
  if (text.startsWith("<!--", index)) {
    const end = text.indexOf("-->", index + 4);
    return { value: "", nextIndex: end < 0 ? text.length : end + 3 };
  }
  const autolink = /^<(https?:\/\/[^>]+)>/iu.exec(text.slice(index));
  if (autolink) {
    const url = autolink[1];
    return {
      value: `[${escapeTelegramText(url)}](${escapeLinkDestination(url)})`,
      nextIndex: index + autolink[0].length
    };
  }
  const tag = /^<\/?([A-Za-z][\w-]*)(?:\s[^>]*)?>/u.exec(text.slice(index));
  if (!tag) {
    return null;
  }
  const isClosing = tag[0][1] === "/";
  const tagName = tag[1].toLowerCase();
  const nextIndex = index + tag[0].length;
  if (tagName === "br" && !isClosing) {
    return { value: "\n", nextIndex };
  }
  const marker = HTML_MARKERS[tagName];
  if (marker && !isClosing) {
    const closingTag = new RegExp(`</${tagName}\\s*>`, "iu");
    const closingMatch = closingTag.exec(text.slice(nextIndex));
    if (closingMatch && closingMatch.index >= 0) {
      const inner = text.slice(nextIndex, nextIndex + closingMatch.index);
      const convertedInner = convertInline(inner);
      const value = marker === "bold" ? `*${convertedInner}*` : marker === "italic" ? `_${convertedInner}_` : marker === "underline" ? `__${convertedInner}__` : `~${convertedInner}~`;
      return {
        value,
        nextIndex: nextIndex + closingMatch.index + closingMatch[0].length
      };
    }
  }
  return { value: "", nextIndex };
}
function convertInline(text) {
  let result = "";
  for (let index = 0; index < text.length; ) {
    if (text.startsWith("%%", index)) {
      const end = text.indexOf("%%", index + 2);
      if (end >= 0) {
        index = end + 2;
        continue;
      }
    }
    if (text[index] === "\\") {
      const next = text[index + 1];
      if (next && TELEGRAM_SPECIAL_CHARACTERS.has(next)) {
        result += `\\${next}`;
        index += 2;
        continue;
      }
      result += "\\\\";
      index += 1;
      continue;
    }
    const html = text[index] === "<" ? convertHtmlTag(text, index) : null;
    if (html) {
      result += html.value;
      index = html.nextIndex;
      continue;
    }
    const wikilinkStart = text.startsWith("![[", index) ? index + 3 : text.startsWith("[[", index) ? index + 2 : -1;
    if (wikilinkStart >= 0) {
      const end = text.indexOf("]]", wikilinkStart);
      if (end >= 0) {
        result += escapeTelegramText(getWikilinkLabel(text.slice(wikilinkStart, end)));
        index = end + 2;
        continue;
      }
    }
    const isImage = text.startsWith("![", index);
    const isLink = isImage || text[index] === "[";
    if (isLink) {
      const labelStart = index + (isImage ? 2 : 1);
      const labelEnd = findClosingBracket(text, labelStart);
      if (labelEnd >= 0 && text[labelEnd + 1] === "(") {
        const linkEnd = findLinkEnd(text, labelEnd + 1);
        if (linkEnd >= 0) {
          const label = text.slice(labelStart, labelEnd);
          const destination = text.slice(labelEnd + 2, linkEnd);
          const visibleLabel = label || "link";
          result += `[${convertInline(visibleLabel)}](${escapeLinkDestination(destination)})`;
          index = linkEnd + 1;
          continue;
        }
      }
    }
    if (text[index] === "`") {
      let delimiterLength = 1;
      while (text[index + delimiterLength] === "`") {
        delimiterLength += 1;
      }
      const delimiter = "`".repeat(delimiterLength);
      const end = findUnescaped(text, delimiter, index + delimiterLength);
      if (end >= 0) {
        const code = text.slice(index + delimiterLength, end).trim();
        result += `\`${escapeTelegramCode(code)}\``;
        index = end + delimiterLength;
        continue;
      }
    }
    const formatting = [
      { source: "***", target: "bold-italic" },
      { source: "___", target: "bold-italic" },
      { source: "**", target: "bold" },
      { source: "__", target: "bold" },
      { source: "~~", target: "strike" },
      { source: "==", target: "plain" },
      { source: "*", target: "italic" },
      { source: "_", target: "italic" }
    ];
    const token = formatting.find(
      (candidate) => text.startsWith(candidate.source, index) && canOpenFormatting(text, index, candidate.source)
    );
    if (token) {
      const end = findFormattingEnd(text, token.source, index + token.source.length);
      if (end > index + token.source.length) {
        const inner = convertInline(text.slice(index + token.source.length, end));
        if (token.target === "bold-italic") {
          result += `*_${inner}_*`;
        } else if (token.target === "bold") {
          result += `*${inner}*`;
        } else if (token.target === "strike") {
          result += `~${inner}~`;
        } else if (token.target === "italic") {
          result += `_${inner}_`;
        } else {
          result += inner;
        }
        index = end + token.source.length;
        continue;
      }
    }
    const bareUrl = /^(https?:\/\/[^\s<>()]+)/iu.exec(text.slice(index));
    if (bareUrl) {
      const url = bareUrl[1].replace(/[.,!?]+$/u, "");
      if (url) {
        result += `[${escapeTelegramText(url)}](${escapeLinkDestination(url)})`;
        index += url.length;
        continue;
      }
    }
    result += escapeTelegramText(text[index]);
    index += 1;
  }
  return result;
}
function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) {
    row = row.slice(1);
  }
  if (row.endsWith("|")) {
    row = row.slice(0, -1);
  }
  return row.split("|").map((cell) => cell.trim());
}
function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}
function isTableRow(line) {
  return line.includes("|") && line.trim().length > 0;
}
function convertTableRow(line, isHeader) {
  const cells = splitTableRow(line).filter((cell) => cell.length > 0);
  if (cells.length === 0) {
    return "";
  }
  const content = cells.map((cell, index) => {
    const value = convertInline(cell);
    return isHeader && index === 0 ? `*${value}*` : value;
  }).join(" \u2014 ");
  return `\u2022 ${content}`;
}
function convertCalloutBody(body) {
  const match = /^\[!([^\]\s]+)\]([+-])?\s*(.*)$/u.exec(body);
  if (!match) {
    return null;
  }
  const type = match[1].replaceAll("-", " ");
  const title = match[3].trim();
  const label = title ? `${type}: ${title}` : type;
  return `>*${convertInline(label)}*`;
}
function convertListItem(line) {
  const match = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/u.exec(line);
  if (!match) {
    return null;
  }
  const indent = match[1].replaceAll("	", "  ");
  const marker = match[2];
  let content = match[3];
  let taskMarker = "";
  const task = /^\[([ xX-])\]\s*/u.exec(content);
  if (task) {
    taskMarker = task[1].toLowerCase() === "x" ? "\u2611 " : task[1] === "-" ? "\u2612 " : "\u2610 ";
    content = content.slice(task[0].length);
  }
  const bullet = /^\d/u.test(marker) ? `${marker.slice(0, -1)}\\${marker.at(-1)}` : "\u2022";
  return `${indent}${bullet} ${taskMarker}${convertInline(content)}`;
}
function convertBlockquote(line) {
  const match = /^\s{0,3}>\s?(.*)$/u.exec(line);
  if (!match) {
    return null;
  }
  return convertCalloutBody(match[1]) ?? `>${convertInline(match[1])}`;
}
function isHorizontalRule(line) {
  return /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(line);
}
function getFrontmatterEnd(lines) {
  if (!/^---\s*$/u.test(lines[0] ?? "")) {
    return -1;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)\s*$/u.test(lines[index])) {
      return index;
    }
  }
  return -1;
}
function convertFenceLanguage(rawLanguage) {
  return rawLanguage.trim().replace(/\s.*$/u, "");
}
function convertToTelegramMarkdownV2(markdown) {
  const normalized = markdown.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const frontmatterEnd = getFrontmatterEnd(lines);
  const output = [];
  let fenceCharacter = null;
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (index <= frontmatterEnd) {
      continue;
    }
    const line = lines[index];
    const fence = /^\s{0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fenceCharacter) {
      const closingFence = new RegExp(`^\\s{0,3}${fenceCharacter}{${fenceLength},}\\s*$`, "u");
      if (closingFence.test(line)) {
        output.push("```");
        fenceCharacter = null;
        fenceLength = 0;
      } else {
        output.push(escapeTelegramCode(line));
      }
      continue;
    }
    if (fence) {
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
      output.push(`\`\`\`${convertFenceLanguage(fence[2])}`);
      continue;
    }
    if (isTableRow(line) && isTableSeparator(lines[index + 1] ?? "")) {
      output.push(convertTableRow(line, true));
      index += 2;
      while (index < lines.length && isTableRow(lines[index]) && !isTableSeparator(lines[index])) {
        output.push(convertTableRow(lines[index], false));
        index += 1;
      }
      index -= 1;
      continue;
    }
    const listItem = convertListItem(line);
    if (listItem !== null) {
      output.push(listItem);
      continue;
    }
    const blockquote = convertBlockquote(line);
    if (blockquote !== null) {
      output.push(blockquote);
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      output.push(`*${convertInline(heading[1])}*`);
      continue;
    }
    if (isHorizontalRule(line)) {
      output.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
      continue;
    }
    output.push(convertInline(line));
  }
  return output.join("\n");
}

// src/main.ts
var TelegramMarkdownV2ExporterPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.addRibbonIcon("clipboard", "Copy current note as Telegram MarkdownV2", () => {
      void this.copyCurrentNote();
    });
    this.addCommand({
      id: "copy-current-note-as-telegram-markdownv2",
      name: "Copy current note as Telegram MarkdownV2",
      callback: () => {
        void this.copyCurrentNote();
      }
    });
  }
  async copyCurrentNote() {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") {
      new import_obsidian.Notice("Telegram MarkdownV2 Exporter: open a Markdown note first.");
      return;
    }
    try {
      const source = await this.app.vault.read(file);
      const exported = convertToTelegramMarkdownV2(source);
      await navigator.clipboard.writeText(exported);
      new import_obsidian.Notice(`Copied ${file.basename} as Telegram MarkdownV2.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian.Notice(`Telegram MarkdownV2 Exporter: ${message}`);
      console.error("Telegram MarkdownV2 Exporter failed:", error);
    }
  }
};
