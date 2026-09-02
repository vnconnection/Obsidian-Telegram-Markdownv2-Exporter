import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const RELEASE_ASSETS = ["main.js", "manifest.json"];
export const RELEASE_PACKAGE_NAME = "telegram-markdownv2-exporter";
export const RELEASE_MANIFEST_ID = "telegram-markdownv2-exporter";
export const RELEASE_NOTES_DIRECTORY = join("docs", "releases");
export const RELEASE_IMPACTS = ["major", "minor", "patch", "none", "unknown"];
export const SEMVER_TAG_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const RELEASE_NOTE_SECTIONS = new Set([
  "Summary",
  "User-visible changes",
  "Added",
  "Changed",
  "Fixed",
  "Breaking changes",
  "Migration",
  "Documentation",
]);
const RELEASE_NOTE_SECTION_ORDER = [
  "Summary",
  "User-visible changes",
  "Added",
  "Changed",
  "Fixed",
  "Breaking changes",
  "Migration",
  "Documentation",
];
const RELEASE_NOTE_SECTION_PATTERN = /^## (Summary|User-visible changes|Added|Changed|Fixed|Breaking changes|Migration|Documentation)$/;
const GENERIC_AUTHORED_NOTE_PATTERN = /^(?:because|changes?|generic|misc(?:ellaneous)?|n\/a|na|none|no changes?|not applicable|pending|placeholder|release(?: notes?)?|same as above|see above|tbd|todo|update(?:d|s)?|various|wip)\.?$/i;
const UNSAFE_AUTHORED_NOTE_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BREAKING_FOOTER_PREFIX_PATTERN = /^\s*BREAKING(?:[ \t]+CHANGE(?:S)?|-CHANGE(?:S)?)(?=[ \t:]|$)/i;
const BREAKING_FOOTER_PATTERN = /^\s*BREAKING(?: CHANGE|-CHANGE):[ \t]+(\S.*?)[ \t]*$/i;
const AMBIGUOUS_BREAKING_FOOTER_PATTERN = /^(?:because|change(?:s)?|generic|misc(?:ellaneous)?|n\/a|na|none|no changes?|not applicable|pending|placeholder|same as above|see above|tbd|todo|unknown|ambiguous|update(?:d|s)?|various|wip)\.?$/i;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const gitOutput = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function assertBareSemver(version, label) {
  if (typeof version !== "string" || !SEMVER_TAG_PATTERN.test(version)) {
    throw new Error(`${label} must be an exact bare X.Y.Z semver: ${version}`);
  }
}

function assertNonEmptyFile(path) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`Release asset is missing or empty: ${path}`);
  }
}

function authoredNoteText(value) {
  if (typeof value !== "string" || UNSAFE_AUTHORED_NOTE_PATTERN.test(value)) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return null;
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const isGenericLine = (line) => {
    const withoutListMarker = line.replace(/^(?:(?:[-*+]|[0-9]+[.)])[ \t]+)+/, "").trim();
    return !withoutListMarker || GENERIC_AUTHORED_NOTE_PATTERN.test(withoutListMarker);
  };
  if (lines.length === 0 || lines.every(isGenericLine)) return null;
  return normalized;
}

function assertConcreteAuthoredNote(value, label, notesPath) {
  if (!authoredNoteText(value)) {
    throw new Error(`Release notes ${label} must contain non-empty, concrete, safe authored text: ${notesPath}`);
  }
}

function releaseNotes(rootDirectory, version) {
  const notesPath = join(rootDirectory, RELEASE_NOTES_DIRECTORY, `${version}.md`);
  assertNonEmptyFile(notesPath);
  const notes = readFileSync(notesPath, "utf8");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const preamble = notes.match(
    new RegExp(
      `^# Release ${escaped}\\r?\\n\\r?\\nDate: (\\d{4}-\\d{2}-\\d{2})\\r?\\nImpact: (major|minor|patch|none|unknown)\\r?\\nRationale: ([^\\r\\n]+)(?:\\r?\\n|$)`,
    ),
  );
  if (!preamble) {
    throw new Error(`Release notes must contain exact Date, Impact:, and Rationale: fields: ${notesPath}`);
  }
  const [, date, impact, rationale] = preamble;
  const parsedDate = date ? new Date(`${date}T00:00:00Z`) : null;
  if (!date || !parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error(`Release notes date is missing or invalid: ${notesPath}`);
  }
  if (impact === "none" || impact === "unknown") {
    throw new Error(`Release notes Impact must be major, minor, or patch for a release: ${notesPath}`);
  }
  const sections = new Map();
  const sectionHeadings = [...notes.matchAll(/^##[^\r\n]*$/gm)];
  const newline = notes.includes("\r\n") ? "\r\n" : "\n";
  const blankLine = `${newline}${newline}`;
  const preambleEnd = preamble.index + preamble[0].length;
  const firstSectionIndex = sectionHeadings[0]?.index ?? notes.length;
  if (notes.slice(preambleEnd, firstSectionIndex) !== newline) {
    throw new Error(`Release notes must use the canonical blank line before sections: ${notesPath}`);
  }
  let previousSectionIndex = -1;
  for (let index = 0; index < sectionHeadings.length; index += 1) {
    const heading = sectionHeadings[index];
    const title = heading[0].match(RELEASE_NOTE_SECTION_PATTERN)?.[1];
    if (!title || !RELEASE_NOTE_SECTIONS.has(title)) {
      throw new Error(`Release notes contain an unknown section: ${heading[0].trim()}: ${notesPath}`);
    }
    const sectionOrderIndex = RELEASE_NOTE_SECTION_ORDER.indexOf(title);
    if (sectionOrderIndex <= previousSectionIndex) {
      throw new Error(`Release notes sections must follow the canonical order: ${notesPath}`);
    }
    previousSectionIndex = sectionOrderIndex;
    if (sections.has(title)) {
      throw new Error(`Release notes contain duplicate ## ${title} sections: ${notesPath}`);
    }
    const contentStart = heading.index + heading[0].length;
    const contentEnd = sectionHeadings[index + 1]?.index ?? notes.length;
    const sectionBody = notes.slice(contentStart, contentEnd);
    const contentWithSeparator = sectionBody.slice(blankLine.length);
    const hasCanonicalStart = sectionBody.startsWith(blankLine) && !contentWithSeparator.startsWith(newline);
    const hasCanonicalSeparator = index === sectionHeadings.length - 1 || (
      contentWithSeparator.endsWith(blankLine) && !contentWithSeparator.endsWith(`${blankLine}${newline}`)
    );
    if (!hasCanonicalStart || !hasCanonicalSeparator) {
      throw new Error(`Release notes section ## ${title} must use exactly one canonical blank line before content and between sections: ${notesPath}`);
    }
    const content = contentWithSeparator.trim();
    assertConcreteAuthoredNote(content, `## ${title}`, notesPath);
    sections.set(title, content);
  }

  const requiredSections = ["Summary", "User-visible changes"];
  for (const title of requiredSections) {
    const content = sections.get(title);
    if (!content) {
      throw new Error(`Release notes must contain a non-empty ## ${title}: ${notesPath}`);
    }
  }
  if (impact === "major") {
    for (const title of ["Breaking changes", "Migration"]) {
      const content = sections.get(title);
      if (!content) {
        throw new Error(`Major release notes must contain a non-empty ## ${title} section: ${notesPath}`);
      }
    }
  } else {
    for (const title of ["Breaking changes", "Migration"]) {
      if (sections.has(title)) {
        throw new Error(`Release notes ## ${title} is only allowed for major impact: ${notesPath}`);
      }
    }
  }
  assertConcreteAuthoredNote(rationale, "Rationale", notesPath);
  return { notesPath, notes, impact };
}

export function validateRelease({ rootDirectory = process.cwd(), expectedVersion } = {}) {
  const packageJson = readJson(join(rootDirectory, "package.json"));
  const manifest = readJson(join(rootDirectory, "manifest.json"));
  const versions = readJson(join(rootDirectory, "versions.json"));
  const packageLock = readJson(join(rootDirectory, "package-lock.json"));
  const version = packageJson.version;
  if (packageJson.name !== RELEASE_PACKAGE_NAME) {
    throw new Error(`package.json name must be ${RELEASE_PACKAGE_NAME}`);
  }
  assertBareSemver(version, "package.json version");
  if (manifest.id !== RELEASE_MANIFEST_ID) throw new Error(`manifest.json id must be ${RELEASE_MANIFEST_ID}`);
  if (manifest.version !== version) throw new Error(`manifest.json version (${manifest.version}) does not match package.json version (${version})`);
  if (
    packageLock.name !== RELEASE_PACKAGE_NAME ||
    packageLock.version !== version ||
    packageLock.packages?.[""]?.name !== RELEASE_PACKAGE_NAME ||
    packageLock.packages?.[""]?.version !== version
  ) {
    throw new Error(`package-lock.json version does not match package.json version (${version})`);
  }
  if (typeof manifest.minAppVersion !== "string" || manifest.minAppVersion.trim().length === 0) {
    throw new Error("manifest.json minAppVersion must be a non-empty string");
  }
  if (!versions || typeof versions !== "object" || Array.isArray(versions) || versions[version] !== manifest.minAppVersion) {
    throw new Error(`versions.json must map ${version} to manifest.minAppVersion (${manifest.minAppVersion})`);
  }
  if (expectedVersion !== undefined) {
    assertBareSemver(expectedVersion, "Expected release version");
    if (expectedVersion !== version) throw new Error(`package.json version (${version}) does not match release tag (${expectedVersion})`);
  }
  const assetPaths = RELEASE_ASSETS.map((asset) => join(rootDirectory, asset));
  assetPaths.forEach(assertNonEmptyFile);
  return { version, manifestId: manifest.id, assetPaths, ...releaseNotes(rootDirectory, expectedVersion ?? version) };
}

export function packageRelease({ rootDirectory = process.cwd(), expectedVersion, outputPath } = {}) {
  const metadata = validateRelease({ rootDirectory, expectedVersion });
  const archivePath = resolve(rootDirectory, outputPath ?? join("artifacts", `telegram-markdownv2-exporter-${metadata.version}.zip`));
  mkdirSync(dirname(archivePath), { recursive: true });
  const temporaryDirectory = mkdtempSync(join(dirname(archivePath), ".release-package-"));
  const temporaryArchive = join(temporaryDirectory, "release.zip");
  try {
    execFileSync("zip", ["-q", "-j", temporaryArchive, ...RELEASE_ASSETS], { cwd: rootDirectory, stdio: "inherit" });
    renameSync(temporaryArchive, archivePath);
    const entries = execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    if (entries.length !== RELEASE_ASSETS.length || entries.some((entry, index) => entry !== RELEASE_ASSETS[index])) {
      throw new Error(`Release ZIP must contain exactly ${RELEASE_ASSETS.join(", ")} at its root: ${archivePath}`);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return { ...metadata, archivePath };
}

export function computeNextVersion(currentVersion, impact) {
  assertBareSemver(currentVersion, "Current version");
  if (!["patch", "minor", "major"].includes(impact)) throw new Error(`Impact must be patch, minor, or major: ${impact}`);
  const [major, minor, patch] = currentVersion.split(".").map(BigInt);
  if (impact === "major") return `${major + 1n}.0.0`;
  if (impact === "minor") return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

function breakingFooterSignal(lines) {
  const firstBlankLine = lines.findIndex((line, index) => index > 0 && line.trim() === "");
  const footerLines = lines.slice(firstBlankLine === -1 ? 1 : firstBlankLine + 1);
  const candidateIndexes = footerLines
    .map((line, index) => BREAKING_FOOTER_PREFIX_PATTERN.test(line) ? index : -1)
    .filter((index) => index !== -1);
  if (candidateIndexes.length === 0) return null;
  if (firstBlankLine === -1 || candidateIndexes.length !== 1) return "unknown";

  const candidateIndex = candidateIndexes[0];
  if (footerLines.slice(candidateIndex + 1).some((line) => line.trim() !== "")) return "unknown";

  const match = footerLines[candidateIndex].match(BREAKING_FOOTER_PATTERN);
  const description = match?.[1]?.trim();
  if (
    !description ||
    !/[\p{L}\p{N}]/u.test(description) ||
    AMBIGUOUS_BREAKING_FOOTER_PATTERN.test(description)
  ) return "unknown";
  return "major";
}

function signalFor(message) {
  const lines = message.split(/\r?\n/);
  const subject = lines[0].trim();
  const breakingFooter = breakingFooterSignal(lines);
  const header = subject.match(/^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?:\s+\S.*$/);
  if (!header) return null;

  const [, type, , breakingMarker] = header;
  const types = {
    breaking: "major",
    feat: "minor",
    fix: "patch",
    perf: "patch",
    docs: "none",
    test: "none",
    chore: "none",
    ci: "none",
    build: "none",
    refactor: "none",
    style: "none",
  };
  if (!Object.hasOwn(types, type)) return null;

  if (breakingFooter === "major") return "major";
  if (breakingFooter === "unknown") return null;

  if (breakingMarker) return "major";
  return types[type];
}

function textPart(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join("\n");
  return null;
}

function structuredCommitText(commit) {
  if (typeof commit === "string") return commit;
  if (!commit || typeof commit !== "object" || Array.isArray(commit)) return null;

  for (const key of ["message", "commitMessage", "raw", "rawMessage"]) {
    if (Object.hasOwn(commit, key)) {
      const message = textPart(commit[key]);
      if (message !== null) return message;
      return null;
    }
  }
  if (commit.commit && typeof commit.commit === "object" && !Array.isArray(commit.commit)) {
    const nestedMessage = structuredCommitText(commit.commit);
    if (nestedMessage !== null) return nestedMessage;
  }

  const header = textPart(commit.header);
  const subject = textPart(commit.subject);
  const type = textPart(commit.type);
  if ((Object.hasOwn(commit, "header") && header === null) ||
      (Object.hasOwn(commit, "subject") && subject === null) ||
      (Object.hasOwn(commit, "type") && type === null)) return null;
  if (header === null && subject === null) return null;

  let firstLine = header ?? subject;
  if (header === null && type !== null && subject !== null && !/^[a-z]+(?:\([^()\r\n]+\))?!?:\s+\S.*$/.test(subject)) {
    const scope = textPart(commit.scope);
    if (Object.hasOwn(commit, "scope") && scope === null) return null;
    const breaking = commit.breaking === true || commit.isBreaking === true || commit.breakingMarker === "!";
    firstLine = `${type}${scope ? `(${scope})` : ""}${breaking ? "!" : ""}: ${subject}`;
  }

  const body = textPart(commit.body);
  const footer = textPart(commit.footer);
  if ((Object.hasOwn(commit, "body") && body === null) ||
      (Object.hasOwn(commit, "footer") && footer === null)) return null;
  return [firstLine, body, footer].filter((part) => part !== null && part !== "").join("\n\n");
}

function commitInputs(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") return [input];
  if (!input || typeof input !== "object") return [];
  const wrapperKeys = ["commitMessages", "messages", "commits"];
  const presentWrapperKeys = wrapperKeys.filter((key) => Object.hasOwn(input, key));
  if (presentWrapperKeys.length > 0) {
    if (presentWrapperKeys.some((key) => !Array.isArray(input[key]))) return [];
    return presentWrapperKeys.flatMap((key) => input[key]);
  }
  return [input];
}

function parseSuppliedClassifyInput(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function classifyImpact(input = []) {
  const messages = commitInputs(input);
  if (!Array.isArray(messages) || messages.length === 0) return "unknown";
  const impacts = messages.map((message) => {
    const text = structuredCommitText(message);
    return text === null ? null : signalFor(text);
  });
  if (impacts.some((impact) => impact === null)) return "unknown";
  if (impacts.includes("major")) return "major";
  if (impacts.includes("minor")) return "minor";
  if (impacts.includes("patch")) return "patch";
  return "none";
}

export function syncMetadata({ rootDirectory = process.cwd(), version }) {
  assertBareSemver(version, "Target version");
  const packageJson = readJson(join(rootDirectory, "package.json"));
  const packageLock = readJson(join(rootDirectory, "package-lock.json"));
  const manifest = readJson(join(rootDirectory, "manifest.json"));
  const versions = readJson(join(rootDirectory, "versions.json"));
  packageJson.version = version;
  packageLock.version = version;
  if (!packageLock.packages?.[""]) throw new Error("package-lock.json is missing its root package entry");
  packageLock.packages[""].version = version;
  manifest.version = version;
  versions[version] = manifest.minAppVersion;
  writeJson(join(rootDirectory, "package.json"), packageJson);
  writeJson(join(rootDirectory, "package-lock.json"), packageLock);
  writeJson(join(rootDirectory, "manifest.json"), manifest);
  writeJson(join(rootDirectory, "versions.json"), versions);
}

function assertCleanWorktree(rootDirectory) {
  let status;
  try {
    status = gitOutput(["status", "--porcelain=v1", "--untracked-files=all"], rootDirectory);
  } catch (error) {
    throw new Error(`Cannot verify Git working tree: ${error.message}`);
  }
  if (status) throw new Error(`Release preparation requires a clean working tree; dirty or staged changes detected:\n${status}`);
}

export function prepareRelease({ rootDirectory = process.cwd(), impact } = {}) {
  if (!["patch", "minor", "major"].includes(impact)) throw new Error(`prepare requires an explicit --impact of patch, minor, or major: ${impact ?? "missing"}`);
  assertCleanWorktree(rootDirectory);
  const currentVersion = readJson(join(rootDirectory, "package.json")).version;
  const targetVersion = computeNextVersion(currentVersion, impact);
  syncMetadata({ rootDirectory, version: targetVersion });
  return { currentVersion, targetVersion, impact };
}

function cliArgs(args) {
  let impact;
  let suppliedInput;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") continue;
    if (args[index] === "--impact") impact = args[++index];
    else if (args[index].startsWith("--impact=")) impact = args[index].slice(9);
    else if (args[index] === "--input") {
      if (index + 1 >= args.length) throw new Error("--input requires a value");
      suppliedInput = args[++index];
    }
    else if (args[index].startsWith("--input=")) suppliedInput = args[index].slice(8);
    else if (args[index].startsWith("--")) throw new Error(`Unknown release option: ${args[index]}`);
    else positional.push(args[index]);
  }
  return {
    command: positional[0] ?? "validate",
    version: positional[1],
    outputPath: positional[2],
    impact,
    suppliedInput,
    positionalInput: positional.slice(1),
  };
}

export function runCli(args = process.argv.slice(2)) {
  const { command, version, outputPath, impact, suppliedInput, positionalInput } = cliArgs(args);
  if (command === "classify") {
    let messages = [];
    const inputArguments = suppliedInput === undefined ? positionalInput : [suppliedInput];
    if (inputArguments.length > 0) {
      messages = inputArguments.length === 1
        ? parseSuppliedClassifyInput(inputArguments[0])
        : inputArguments.map(parseSuppliedClassifyInput);
    } else {
      try {
        const tag = gitOutput(["describe", "--tags", "--abbrev=0"]);
        messages = gitOutput(["log", "--format=%B%x00", `${tag}..HEAD`]).split("\u0000").filter(Boolean);
      } catch {
        messages = gitOutput(["log", "--format=%B%x00", "HEAD"]).split("\u0000").filter(Boolean);
      }
    }
    const result = classifyImpact(messages);
    console.log(result);
    return result;
  }
  if (command === "prepare") {
    const result = prepareRelease({ impact });
    console.log(`Prepared local ${result.impact} release ${result.targetVersion}; no commit, tag, push, or GitHub Release was created.`);
    return result;
  }
  if (command === "validate") {
    const result = validateRelease({ expectedVersion: version });
    console.log(`Release validation passed for ${result.version}`);
    return result;
  }
  if (command === "package") {
    const result = packageRelease({ expectedVersion: version, outputPath });
    console.log(`Release package created -> ${result.archivePath}`);
    return result;
  }
  throw new Error(`Unknown release command: ${command}. Use classify, prepare --impact <impact>, validate, or package.`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCli();
