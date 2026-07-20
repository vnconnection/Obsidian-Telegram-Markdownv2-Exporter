const TELEGRAM_SPECIAL_CHARACTERS = new Set(
  Array.from("_*[]()~`>#+-=|{}.!\\")
);

const HTML_MARKERS: Record<string, "bold" | "italic" | "underline" | "strike"> = {
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

function escapeTelegramText(text: string): string {
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

function escapeTelegramCode(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}

function findUnescaped(text: string, needle: string, from: number): number {
  for (let index = from; index <= text.length - needle.length; index += 1) {
    if (text.startsWith(needle, index) && (index === 0 || text[index - 1] !== "\\")) {
      return index;
    }
  }

  return -1;
}

function isWordCharacter(character: string | undefined): boolean {
  return character ? /^[\p{L}\p{N}_]$/u.test(character) : false;
}

function canOpenFormatting(text: string, index: number, delimiter: string): boolean {
  if (delimiter.length === 1 && isWordCharacter(text[index - 1]) && isWordCharacter(text[index + 1])) {
    return false;
  }

  return true;
}

function canCloseFormatting(text: string, index: number, delimiter: string): boolean {
  if (delimiter.length === 1 && isWordCharacter(text[index - 1]) && isWordCharacter(text[index + delimiter.length])) {
    return false;
  }

  return true;
}

function findFormattingEnd(text: string, delimiter: string, from: number): number {
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

function findClosingBracket(text: string, from: number): number {
  return findUnescaped(text, "]", from);
}

function findLinkEnd(text: string, openParenthesis: number): number {
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

function getLinkDestination(rawDestination: string): string {
  const destination = rawDestination.trim();
  if (destination.startsWith("<")) {
    const closingAngle = destination.indexOf(">");
    if (closingAngle >= 0) {
      return destination.slice(1, closingAngle);
    }
  }

  return destination.split(/\s+/u, 1)[0] ?? "";
}

function escapeLinkDestination(rawDestination: string): string {
  return getLinkDestination(rawDestination)
    .replaceAll("\\", "\\\\")
    .replaceAll(")", "\\)")
    .replaceAll(" ", "%20");
}

function getWikilinkLabel(rawTarget: string): string {
  const aliasParts = rawTarget.split("|");
  const alias = aliasParts.length > 1 ? aliasParts.at(-1) ?? "" : "";
  if (alias.trim()) {
    return alias.trim();
  }

  const target = aliasParts[0] ?? "";
  const withoutSubpath = target.split("#", 1)[0].split("^", 1)[0];
  return withoutSubpath.split("/").at(-1)?.trim() ?? "";
}

function convertHtmlTag(text: string, index: number): { value: string; nextIndex: number } | null {
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
      const value = marker === "bold"
        ? `*${convertedInner}*`
        : marker === "italic"
          ? `_${convertedInner}_`
          : marker === "underline"
            ? `__${convertedInner}__`
            : `~${convertedInner}~`;
      return {
        value,
        nextIndex: nextIndex + closingMatch.index + closingMatch[0].length
      };
    }
  }

  // Obsidian supports arbitrary inline HTML. Telegram MarkdownV2 does not;
  // remove the tag while keeping its text content.
  return { value: "", nextIndex };
}

function convertInline(text: string): string {
  let result = "";

  for (let index = 0; index < text.length;) {
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
    ] as const;

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

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) {
    row = row.slice(1);
  }
  if (row.endsWith("|")) {
    row = row.slice(0, -1);
  }
  return row.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

function convertTableRow(line: string, isHeader: boolean): string {
  const cells = splitTableRow(line).filter((cell) => cell.length > 0);
  if (cells.length === 0) {
    return "";
  }

  const content = cells
    .map((cell, index) => {
      const value = convertInline(cell);
      return isHeader && index === 0 ? `*${value}*` : value;
    })
    .join(" — ");
  return `• ${content}`;
}

function convertCalloutBody(body: string): string | null {
  const match = /^\[!([^\]\s]+)\]([+-])?\s*(.*)$/u.exec(body);
  if (!match) {
    return null;
  }

  const type = match[1].replaceAll("-", " ");
  const title = match[3].trim();
  const label = title ? `${type}: ${title}` : type;
  return `>*${convertInline(label)}*`;
}

function convertListItem(line: string): string | null {
  const match = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/u.exec(line);
  if (!match) {
    return null;
  }

  const indent = match[1].replaceAll("\t", "  ");
  const marker = match[2];
  let content = match[3];
  let taskMarker = "";
  const task = /^\[([ xX-])\]\s*/u.exec(content);
  if (task) {
    taskMarker = task[1].toLowerCase() === "x" ? "☑ " : task[1] === "-" ? "☒ " : "☐ ";
    content = content.slice(task[0].length);
  }

  const bullet = /^\d/u.test(marker) ? `${marker.slice(0, -1)}\\${marker.at(-1)}` : "•";
  return `${indent}${bullet} ${taskMarker}${convertInline(content)}`;
}

function convertBlockquote(line: string): string | null {
  const match = /^\s{0,3}>\s?(.*)$/u.exec(line);
  if (!match) {
    return null;
  }

  return convertCalloutBody(match[1]) ?? `>${convertInline(match[1])}`;
}

function isHorizontalRule(line: string): boolean {
  return /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(line);
}

function getFrontmatterEnd(lines: string[]): number {
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

function convertFenceLanguage(rawLanguage: string): string {
  return rawLanguage.trim().replace(/\s.*$/u, "");
}

export function convertToTelegramMarkdownV2(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const frontmatterEnd = getFrontmatterEnd(lines);
  const output: string[] = [];
  let fenceCharacter: "`" | "~" | null = null;
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
      fenceCharacter = fence[1][0] as "`" | "~";
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
      output.push("────────");
      continue;
    }

    output.push(convertInline(line));
  }

  return output.join("\n");
}
