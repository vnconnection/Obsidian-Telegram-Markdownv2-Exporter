import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  afterEach,
  describe,
  it,
} from "node:test";
import {
  classifyImpact,
  computeNextVersion,
  packageRelease,
  prepareRelease,
  syncMetadata,
  validateRelease,
} from "./release.mjs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories = [];

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture({
  version = "0.1.0",
  releaseNotes = `# Release ${version}\n\nDate: 2026-09-02\n\n## Fixed\n\n- Correctly exports the current note to Telegram MarkdownV2.\n`,
  missingAsset,
  emptyAsset,
} = {}) {
  const rootDirectory = mkdtempSync(join(tmpdir(), "telegram-release-"));
  temporaryDirectories.push(rootDirectory);
  writeJson(join(rootDirectory, "package.json"), { version });
  writeJson(join(rootDirectory, "package-lock.json"), {
    name: "telegram-markdownv2-exporter",
    version,
    lockfileVersion: 3,
    packages: { "": { name: "telegram-markdownv2-exporter", version } },
  });
  if (missingAsset !== "manifest.json") {
    writeJson(join(rootDirectory, "manifest.json"), {
      id: "telegram-markdownv2-exporter",
      version,
      minAppVersion: "1.5.0",
    });
  }
  writeJson(join(rootDirectory, "versions.json"), { [version]: "1.5.0" });

  for (const asset of ["main.js", "manifest.json"]) {
    if (asset === missingAsset) continue;
    if (asset === "manifest.json") continue;
    writeFileSync(join(rootDirectory, asset), asset === emptyAsset ? "" : "bundle");
  }
  if (emptyAsset === "manifest.json") writeJson(join(rootDirectory, "manifest.json"), {});

  if (releaseNotes !== null) {
    const notesDirectory = join(rootDirectory, "docs", "releases");
    mkdirSync(notesDirectory, { recursive: true });
    writeFileSync(join(notesDirectory, `${version}.md`), releaseNotes);
  }
  return rootDirectory;
}

function git(rootDirectory, args) {
  return execFileSync("git", args, { cwd: rootDirectory, encoding: "utf8" }).trim();
}

function initializeGitFixture(rootDirectory) {
  git(rootDirectory, ["init", "-q"]);
  git(rootDirectory, ["config", "user.name", "Release tests"]);
  git(rootDirectory, ["config", "user.email", "release-tests@example.invalid"]);
  git(rootDirectory, ["add", "."]);
  git(rootDirectory, ["commit", "-qm", "fixture"]);
}

afterEach(() => {
  for (const rootDirectory of temporaryDirectories.splice(0)) {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

describe("release impact classification", () => {
  it("classifies conventional commits", () => {
    assert.deepEqual(classifyImpact([
      "docs: clarify usage",
      "fix: escape a Telegram delimiter",
    ]), {
      impact: "patch",
      signals: [{ message: "fix: escape a Telegram delimiter", impact: "patch" }],
    });
  });

  it("uses major over minor and patch, then minor over patch", () => {
    assert.equal(classifyImpact(["fix: bug", "feat: option", "fix!: breaking bug"]).impact, "major");
    assert.equal(classifyImpact(["fix: bug", "feat: option"]).impact, "minor");
  });

  it("returns unknown when no supported impact signal exists", () => {
    assert.deepEqual(classifyImpact(["docs: update wording", "chore: refresh tooling"]), {
      impact: "unknown",
      signals: [],
    });
  });

  it("maps impact to the next version", () => {
    assert.equal(computeNextVersion("0.1.0", "patch"), "0.1.1");
    assert.equal(computeNextVersion("0.1.0", "minor"), "0.2.0");
    assert.equal(computeNextVersion("0.1.0", "major"), "1.0.0");
  });
});

describe("release notes and metadata", () => {
  it("accepts versioned authored notes without requiring styles.css", () => {
    const rootDirectory = createFixture();
    assert.equal(validateRelease({ rootDirectory, expectedVersion: "0.1.0" }).version, "0.1.0");
  });

  it("rejects missing, mismatched, invalid, and placeholder notes", () => {
    const cases = [
      [null, /Release asset is missing or empty/],
      ["# Release 0.1.1\n\nDate: 2026-09-02\n\n- A concrete change.\n", /heading/],
      ["# Release 0.1.0\n\nDate: 2026-02-30\n\n- A concrete change.\n", /date/],
      ["# Release 0.1.0\n\nDate: 2026-09-02\n\n- update\n", /concrete change/],
    ];
    for (const [releaseNotes, error] of cases) {
      const rootDirectory = createFixture({ releaseNotes });
      assert.throws(() => validateRelease({ rootDirectory, expectedVersion: "0.1.0" }), error);
    }
  });

  it("synchronizes package, lockfile, manifest, and versions metadata", () => {
    const rootDirectory = createFixture();
    syncMetadata({ rootDirectory, version: "0.1.1" });
    assert.equal(JSON.parse(readFileSync(join(rootDirectory, "package.json"))).version, "0.1.1");
    const packageLock = JSON.parse(readFileSync(join(rootDirectory, "package-lock.json")));
    assert.equal(packageLock.version, "0.1.1");
    assert.equal(packageLock.packages[""].version, "0.1.1");
    assert.equal(JSON.parse(readFileSync(join(rootDirectory, "manifest.json"))).version, "0.1.1");
    assert.equal(JSON.parse(readFileSync(join(rootDirectory, "versions.json"), "utf8"))["0.1.1"], "1.5.0");
  });
});

describe("release assets and publication boundary", () => {
  it("requires each non-empty production asset", () => {
    for (const asset of ["main.js", "manifest.json"]) {
      const rootDirectory = createFixture({ missingAsset: asset });
      assert.throws(() => validateRelease({ rootDirectory }), /Release asset is missing or empty|ENOENT/);
    }
    const rootDirectory = createFixture({ emptyAsset: "main.js" });
    assert.throws(() => validateRelease({ rootDirectory }), /Release asset is missing or empty/);
  });

  it("packages exactly the required assets at the ZIP root", () => {
    const rootDirectory = createFixture();
    const archivePath = join(rootDirectory, "artifacts", "release.zip");
    packageRelease({ rootDirectory, expectedVersion: "0.1.0", outputPath: archivePath });
    assert.deepEqual(
      execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" }).trim().split("\n"),
      ["main.js", "manifest.json"],
    );
  });

  it("prepares metadata without publishing, tagging, or creating artifacts", () => {
    const rootDirectory = createFixture();
    initializeGitFixture(rootDirectory);
    assert.deepEqual(prepareRelease({ rootDirectory, impact: "patch" }), {
      currentVersion: "0.1.0",
      targetVersion: "0.1.1",
      impact: "patch",
    });
    assert.equal(git(rootDirectory, ["tag", "--list"]), "");
    assert.equal(git(rootDirectory, ["remote"]), "");
    assert.equal(readFileSync(join(rootDirectory, "package.json"), "utf8").includes('"version": "0.1.1"'), true);
  });

  it("keeps publication commands out of the local release script", () => {
    const source = readFileSync(new URL("./release.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /execFileSync\("git",\s*\[\s*"(?:push|tag)"/);
    assert.doesNotMatch(source, /gh\s+release\s+(?:create|upload|edit)/);
  });
});

describe("GitHub Actions release workflow", () => {
  it("uses bare semver tags, npm gates, authored notes, and the asset contract", () => {
    const workflow = readFileSync(new URL("./.github/workflows/release.yml", import.meta.url), "utf8");
    assert.match(workflow, /- "0\.\[0-9\]\*\.\[0-9\]\*"/);
    assert.match(workflow, /- "\[1-9\]\*\.\[0-9\]\*\.\[0-9\]\*"/);
    assert.match(workflow, /npm ci/);
    assert.match(workflow, /npm run typecheck/);
    assert.match(workflow, /npm test/);
    assert.match(workflow, /node --test release\.test\.mjs/);
    assert.match(workflow, /npm run build/);
    assert.match(workflow, /npm run release:validate -- \"\$GITHUB_REF_NAME\"/);
    assert.match(workflow, /--notes-file \"\$RELEASE_NOTES_PATH\"/);
    assert.doesNotMatch(workflow, /--generate-notes/);
    assert.match(workflow, /release_assets=\(main\.js manifest\.json \"\$ZIP_PATH\"\)/);
    assert.match(workflow, /expected_entries=\(main\.js manifest\.json\)/);
  });
});
