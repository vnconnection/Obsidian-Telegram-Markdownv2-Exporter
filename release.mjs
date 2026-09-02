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
export const RELEASE_MANIFEST_ID = "telegram-markdownv2-exporter";
export const RELEASE_NOTES_DIRECTORY = join("docs", "releases");
export const RELEASE_IMPACTS = ["major", "minor", "patch", "none", "unknown"];
export const SEMVER_TAG_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

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

function releaseNotes(rootDirectory, version) {
  const notesPath = join(rootDirectory, RELEASE_NOTES_DIRECTORY, `${version}.md`);
  assertNonEmptyFile(notesPath);
  const notes = readFileSync(notesPath, "utf8");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^# Release ${escaped}\\s*$`, "m").test(notes)) {
    throw new Error(`Release notes heading must be # Release ${version}`);
  }
  const date = notes.match(/^Date: (\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
  const parsedDate = date ? new Date(`${date}T00:00:00Z`) : null;
  if (!date || !parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error(`Release notes date is missing or invalid: ${notesPath}`);
  }
  const sections = new Map();
  const sectionHeadings = [...notes.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)];
  for (let index = 0; index < sectionHeadings.length; index += 1) {
    const heading = sectionHeadings[index];
    const title = heading[1].trim().toLowerCase();
    const contentStart = heading.index + heading[0].length;
    const contentEnd = sectionHeadings[index + 1]?.index ?? notes.length;
    sections.set(title, notes.slice(contentStart, contentEnd).trim());
  }

  const requiredSections = ["summary", "impact", "rationale"];
  for (const title of requiredSections) {
    const content = sections.get(title);
    if (!content || /^(?:[-*][ \t]*)?(?:update|todo|tbd|n\/a|none)\.?$/i.test(content)) {
      throw new Error(`Release notes must contain a non-empty ## ${title[0].toUpperCase()}${title.slice(1)} section: ${notesPath}`);
    }
  }
  if (!/\b(?:major|minor|patch|none|unknown)\b/i.test(sections.get("impact"))) {
    throw new Error(`Release notes Impact must name one of major, minor, patch, none, or unknown: ${notesPath}`);
  }
  const impact = sections.get("impact").match(/\b(major|minor|patch|none|unknown)\b/i)?.[1].toLowerCase();
  if (impact === "major") {
    for (const title of ["breaking changes", "migration"]) {
      const content = sections.get(title);
      if (!content || /^(?:[-*][ \t]*)?(?:update|todo|tbd|n\/a|none)\.?$/i.test(content)) {
        throw new Error(`Major release notes must contain a non-empty ## ${title.replace(/\b\w/g, (letter) => letter.toUpperCase())} section: ${notesPath}`);
      }
    }
  }
  if (/^(?:update|todo|tbd|n\/a|user-visible change\.?)$/i.test(sections.get("summary"))) {
    throw new Error(`Release notes must contain a concrete change: ${notesPath}`);
  }
  return { notesPath, notes, impact };
}

export function validateRelease({ rootDirectory = process.cwd(), expectedVersion } = {}) {
  const packageJson = readJson(join(rootDirectory, "package.json"));
  const manifest = readJson(join(rootDirectory, "manifest.json"));
  const versions = readJson(join(rootDirectory, "versions.json"));
  const packageLock = readJson(join(rootDirectory, "package-lock.json"));
  const version = packageJson.version;
  assertBareSemver(version, "package.json version");
  if (manifest.id !== RELEASE_MANIFEST_ID) throw new Error(`manifest.json id must be ${RELEASE_MANIFEST_ID}`);
  if (manifest.version !== version) throw new Error(`manifest.json version (${manifest.version}) does not match package.json version (${version})`);
  if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
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
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return { ...metadata, archivePath };
}

export function computeNextVersion(currentVersion, impact) {
  assertBareSemver(currentVersion, "Current version");
  if (!["patch", "minor", "major"].includes(impact)) throw new Error(`Impact must be patch, minor, or major: ${impact}`);
  const [major, minor, patch] = currentVersion.split(".").map(Number);
  if (impact === "major") return `${major + 1}.0.0`;
  if (impact === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function signalFor(message) {
  const lines = message.split(/\r?\n/);
  const subject = lines[0].trim();
  const header = subject.match(/^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?:\s+\S.*$/);
  const footerStart = lines.findIndex((line, index) => index > 0 && line.trim() === "");
  const footerLines = footerStart === -1 ? [] : lines.slice(footerStart + 1);
  const hasBreakingFooter = footerLines.some((line) => /^\s*BREAKING(?:[ -])CHANGE\s*:/i.test(line));
  if (hasBreakingFooter) return "major";
  if (!header) return null;

  const [, type, , breakingMarker] = header;
  const types = {
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
  if (breakingMarker) return "major";
  return types[type];
}

export function classifyImpact(input = []) {
  const messages = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? [input]
      : input.commitMessages ?? input.messages ?? [];
  const classified = messages.map((message) => {
    const normalizedMessage = String(message);
    return { message: normalizedMessage, impact: signalFor(normalizedMessage) };
  });
  const signals = classified.filter((signal) => signal.impact);
  const hasMalformedNonEmptyMessage = classified.some((signal) => signal.message.trim().length > 0 && !signal.impact);
  const impact = hasMalformedNonEmptyMessage
    ? "unknown"
    : signals.some((signal) => signal.impact === "major")
      ? "major"
      : signals.some((signal) => signal.impact === "minor")
        ? "minor"
        : signals.some((signal) => signal.impact === "patch")
          ? "patch"
          : "none";
  return { impact, signals };
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
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") continue;
    if (args[index] === "--impact") impact = args[++index];
    else if (args[index].startsWith("--impact=")) impact = args[index].slice(9);
    else if (args[index].startsWith("--")) throw new Error(`Unknown release option: ${args[index]}`);
    else positional.push(args[index]);
  }
  return { command: positional[0] ?? "validate", version: positional[1], outputPath: positional[2], impact };
}

export function runCli(args = process.argv.slice(2)) {
  const { command, version, outputPath, impact } = cliArgs(args);
  if (command === "classify") {
    let messages = [];
    try {
      const tag = gitOutput(["describe", "--tags", "--abbrev=0"]);
      messages = gitOutput(["log", "--format=%B%x00", `${tag}..HEAD`]).split("\u0000").filter(Boolean);
    } catch {
      messages = gitOutput(["log", "--format=%B%x00", "HEAD"]).split("\u0000").filter(Boolean);
    }
    const result = classifyImpact(messages);
    console.log(`Advisory release impact: ${result.impact}`);
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
