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
  runCli,
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
  releaseNotes = `# Release ${version}\n\nDate: 2026-09-02\nImpact: patch\nRationale: The intended export contract is corrected without migration.\n\n## Summary\n\nCorrectly exports the current note to Telegram MarkdownV2.\n\n## User-visible changes\n\n- Correctly exports the current note to Telegram MarkdownV2.\n`,
  missingAsset,
  emptyAsset,
  manifestOverrides = {},
  versions = { [version]: "1.5.0" },
} = {}) {
  const rootDirectory = mkdtempSync(join(tmpdir(), "telegram-release-"));
  temporaryDirectories.push(rootDirectory);
  writeJson(join(rootDirectory, "package.json"), { name: "telegram-markdownv2-exporter", version });
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
      ...manifestOverrides,
    });
  }
  writeJson(join(rootDirectory, "versions.json"), versions);

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
    assert.equal(classifyImpact([
      "docs: clarify usage",
      "fix: escape a Telegram delimiter",
    ]), "patch");
  });

  it("classifies supported non-breaking types as none, patch, or minor", () => {
    assert.equal(classifyImpact([
      "test: add coverage",
      "chore: refresh tooling",
      "ci: tighten gates",
      "build: update bundle",
      "refactor: preserve behavior",
      "style: format source",
    ]), "none");
    assert.equal(classifyImpact(["feat: add an option"]), "minor");
    assert.equal(classifyImpact(["perf: reduce export overhead"]), "patch");
    assert.equal(classifyImpact(["breaking: remove the old option"]), "major");
  });

  it("uses major over minor and patch, then minor over patch", () => {
    assert.equal(classifyImpact(["fix: bug", "feat: option", "fix!: breaking bug"]), "major");
    assert.equal(classifyImpact(["fix: bug", "feat: option"]), "minor");
  });

  it("gives unknown precedence over every known impact", () => {
    for (const knownMessage of [
      "docs: clarify usage",
      "fix: correct escaping",
      "feat: add an option",
      "fix!: change the public contract",
    ]) {
      assert.equal(classifyImpact([knownMessage, "not a conventional commit"]), "unknown");
    }
  });

  it("recognizes both breaking footer spellings after a blank line", () => {
    for (const footer of ["BREAKING CHANGE: migrate the setting", "BREAKING-CHANGE: migrate the setting"]) {
      assert.equal(classifyImpact([`fix: change behavior\n\n${footer}`]), "major");
    }
    assert.equal(classifyImpact(["feat!: change behavior"]), "major");
    assert.equal(classifyImpact(["not a conventional commit\n\nBREAKING CHANGE: ignored"]), "unknown");
  });

  it("treats empty or ambiguous breaking footers as unknown", () => {
    for (const footer of [
      "BREAKING CHANGE:",
      "BREAKING CHANGE: ???",
      "BREAKING CHANGE: unknown",
      "BREAKING CHANGES: migrate the setting",
      "BREAKING CHANGE migrate the setting",
    ]) {
      assert.equal(classifyImpact([`fix: change behavior\n\n${footer}`]), "unknown");
    }
    assert.equal(classifyImpact(["docs: clarify usage\n\nBREAKING CHANGE: migrate the setting"]), "major");
  });

  it("honors supplied release:classify input with the normal parser", () => {
    const originalLog = console.log;
    console.log = () => {};
    try {
      assert.equal(runCli(["classify", JSON.stringify({
        messages: [{ type: "fix", subject: "change behavior", footer: "BREAKING CHANGE: migrate the setting" }],
      })]), "major");
      assert.equal(runCli(["classify", "--input", JSON.stringify([
        { type: "fix", subject: "change behavior", footer: "BREAKING CHANGE: migrate the setting" },
      ])]), "major");
      assert.equal(runCli(["classify", `--input=${JSON.stringify(["feat: add an option"])}`]), "minor");
      assert.equal(runCli(["classify", ""]), "unknown");
      assert.equal(runCli(["classify", "feat: add an option", "not a conventional commit"]), "unknown");
      assert.throws(() => runCli(["classify", "--input"]), /--input requires a value/);
    } finally {
      console.log = originalLog;
    }
  });

  it("returns unknown for malformed nonempty messages and mixed unknown blocks", () => {
    assert.equal(classifyImpact(["not a conventional commit"]), "unknown");
    assert.equal(classifyImpact(["fix: bug", "not a conventional commit"]), "unknown");
    assert.equal(classifyImpact([]), "unknown");
    assert.equal(classifyImpact(""), "unknown");
    assert.equal(classifyImpact(null), "unknown");
  });

  it("returns unknown for empty structured commit inputs", () => {
    for (const input of [
      {},
      { messages: [] },
      { messages: [{}] },
      { messages: [{ message: "" }] },
      { messages: [{ header: [] }] },
      { commits: {} },
      { commitMessages: [null] },
    ]) {
      assert.equal(classifyImpact(input), "unknown");
    }
  });

  it("classifies structured commit inputs with the same rules as text commits", () => {
    assert.equal(classifyImpact({
      commitMessages: [
        { header: "docs: clarify usage" },
        { message: "fix: escape a Telegram delimiter" },
      ],
    }), "patch");
    assert.equal(classifyImpact({
      messages: [
        { type: "fix", subject: "change the escaping", body: "Keep the public output stable." },
        { type: "feat", subject: "add an option" },
      ],
    }), "minor");
    assert.equal(classifyImpact({
      commits: [{ header: "fix: change behavior", footer: "BREAKING CHANGE: migrate the setting" }],
    }), "major");
    assert.equal(classifyImpact({ messages: [
      { header: "fix: bug" },
      { subject: "not a conventional commit" },
    ] }), "unknown");
  });

  it("maps supported impacts across semver boundaries", () => {
    for (const [currentVersion, impact, expectedVersion] of [
      ["0.0.0", "patch", "0.0.1"],
      ["0.1.0", "minor", "0.2.0"],
      ["0.9.9", "patch", "0.9.10"],
      ["0.9.4", "major", "1.0.0"],
      ["1.2.3", "minor", "1.3.0"],
      ["1.2.3", "major", "2.0.0"],
    ]) {
      assert.equal(computeNextVersion(currentVersion, impact), expectedVersion);
    }
  });

  it("rejects non-canonical versions and unsupported impacts", () => {
    for (const version of ["1.2", "01.2.3", "1.02.3", "1.2.03", "v1.2.3"]) {
      assert.throws(() => computeNextVersion(version, "patch"), /exact bare X\.Y\.Z semver/);
    }
    assert.throws(() => computeNextVersion("1.2.3", "none"), /Impact must be patch, minor, or major/);
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
      ["# Release 0.1.1\n\nDate: 2026-09-02\nImpact: patch\nRationale: Because.\n\n## Summary\n\nA concrete change.\n\n## User-visible changes\n\n- A concrete change.\n", /exact Date, Impact:, and Rationale:/],
      ["# Release 0.1.0\n\nDate: 2026-02-30\nImpact: patch\nRationale: Because.\n\n## Summary\n\nA concrete change.\n\n## User-visible changes\n\n- A concrete change.\n", /date/],
      ["# Release 0.1.0\n\nDate: 2026-09-02\nImpact: patch\nRationale: Because.\n\n## Summary\n\nupdate\n\n## User-visible changes\n\n- A concrete change.\n", /non-empty|concrete change/],
      ["# Release 0.1.0\n\nDate: 2026-09-02\nImpact: patch — backward-compatible\nRationale: Because.\n\n## Summary\n\nA concrete change.\n\n## User-visible changes\n\n- A concrete change.\n", /exact Date, Impact:, and Rationale:/],
      ["# Release 0.1.0\n\nDate: 2026-09-02\nImpact: none\nRationale: Because.\n\n## Summary\n\nA concrete change.\n\n## User-visible changes\n\n- A concrete change.\n", /Impact/],
      ["# Release 0.1.0\n\nDate: 2026-09-02\nImpact: unknown\nRationale: Because.\n\n## Summary\n\nA concrete change.\n\n## User-visible changes\n\n- A concrete change.\n", /Impact/],
      ["# Release 0.1.0\n\nDate: 2026-09-02\n\n## Summary\n\nA concrete change.\n\n## Impact\n\npatch\n\n## Rationale\n\nBecause.\n\n## User-visible changes\n\n- A concrete change.\n", /exact Date, Impact, and Rationale|Impact/],
    ];
    for (const [releaseNotes, error] of cases) {
      const rootDirectory = createFixture({ releaseNotes });
      assert.throws(() => validateRelease({ rootDirectory, expectedVersion: "0.1.0" }), error);
    }
  });

  it("rejects whitespace-only, generic, and unsafe authored note content consistently", () => {
    const note = (rationale, summary = "A concrete change.") => `# Release 0.1.0\n\nDate: 2026-09-02\nImpact: patch\nRationale: ${rationale}\n\n## Summary\n\n${summary}\n\n## User-visible changes\n\n- A concrete change.\n`;
    for (const rationale of ["   ", "\t", "- update", "Because."]) {
      assert.throws(
        () => validateRelease({ rootDirectory: createFixture({ releaseNotes: note(rationale) }) }),
        /Rationale.*concrete, safe authored text/,
      );
    }
    assert.throws(
      () => validateRelease({ rootDirectory: createFixture({ releaseNotes: note("A concrete reason.", "- update") }) }),
      /## Summary.*concrete, safe authored text/,
    );
    assert.throws(
      () => validateRelease({ rootDirectory: createFixture({
        releaseNotes: `${note("A concrete reason.")}\n## Added\n\nnone\n`,
      }) }),
      /## Added.*concrete, safe authored text/,
    );
    assert.throws(
      () => validateRelease({ rootDirectory: createFixture({ releaseNotes: note("A concrete\u0000reason.") }) }),
      /Rationale.*concrete, safe authored text/,
    );
  });

  it("requires breaking changes and migration sections for major notes", () => {
    const majorNotes = `# Release 0.1.0\n\nDate: 2026-09-02\nImpact: major\nRationale: The public contract changes.\n\n## Summary\n\nA breaking export change.\n\n## User-visible changes\n\n- Existing exports use a new contract.\n`;
    assert.throws(() => validateRelease({ rootDirectory: createFixture({ releaseNotes: majorNotes }) }), /Breaking changes/);
    assert.throws(() => validateRelease({ rootDirectory: createFixture({
      releaseNotes: `${majorNotes}\n## Breaking changes\n\n- Rename the setting.\n`,
    }) }), /Migration/);
    assert.doesNotThrow(() => validateRelease({ rootDirectory: createFixture({
      releaseNotes: `${majorNotes}\n## Breaking changes\n\n- Rename the setting.\n\n## Migration\n\n- Rename the setting in your configuration.\n`,
    }) }));
  });

  it("rejects non-canonical section headings and ordering", () => {
    const note = (sections) => `# Release 0.1.0\n\nDate: 2026-09-02\nImpact: patch\nRationale: A concrete release reason.\n\n${sections}\n`;
    for (const sections of [
      "## Summary \n\nA concrete summary.\n\n## User-visible changes\n\nA concrete change.",
      "##Summary\n\nA concrete summary.\n\n## User-visible changes\n\nA concrete change.",
      "## User-visible changes\n\nA concrete change.\n\n## Summary\n\nA concrete summary.",
      "## Summary\nA concrete summary.\n\n## User-visible changes\n\nA concrete change.",
    ]) {
      assert.throws(() => validateRelease({ rootDirectory: createFixture({ releaseNotes: note(sections) }) }), /canonical|unknown section|blank line/);
    }
  });

  it("requires exactly one blank line around each canonical section", () => {
    const note = (sections) => `# Release 0.1.0\n\nDate: 2026-09-02\nImpact: patch\nRationale: A concrete release reason.\n\n${sections}\n`;
    for (const sections of [
      "## Summary\n\n\nA concrete summary.\n\n## User-visible changes\n\nA concrete change.",
      "## Summary\n\nA concrete summary.\n\n\n## User-visible changes\n\nA concrete change.",
    ]) {
      assert.throws(
        () => validateRelease({ rootDirectory: createFixture({ releaseNotes: note(sections) }) }),
        /canonical blank line/,
      );
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

  it("rejects a wrong manifest id or version-map entry", () => {
    assert.throws(() => validateRelease({ rootDirectory: createFixture({ manifestOverrides: { id: "wrong-id" } }) }), /manifest.json id/);
    assert.throws(() => validateRelease({ rootDirectory: createFixture({ versions: { "0.1.0": "1.6.0" } }) }), /versions.json must map/);
  });

  it("requires strict package metadata", () => {
    const packageNameMismatch = createFixture();
    writeJson(join(packageNameMismatch, "package.json"), { name: "other-plugin", version: "0.1.0" });
    assert.throws(() => validateRelease({ rootDirectory: packageNameMismatch }), /package.json name/);

    const lockNameMismatch = createFixture();
    writeJson(join(lockNameMismatch, "package-lock.json"), {
      name: "other-plugin",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: { "": { name: "other-plugin", version: "0.1.0" } },
    });
    assert.throws(() => validateRelease({ rootDirectory: lockNameMismatch }), /package-lock.json/);
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
    assert.match(workflow, /- "\[1-9\]\[0-9\]\*\.\[0-9\]\*\.\[0-9\]\*"/);
    assert.match(workflow, /npm ci/);
    assert.match(workflow, /npm run typecheck/);
    assert.match(workflow, /npm test/);
    assert.match(workflow, /node --test release\.test\.mjs/);
    assert.match(workflow, /npm run build/);
    assert.match(workflow, /Verify tracked bundle before build[\s\S]*?git ls-files --error-unmatch -- main\.js[\s\S]*?git diff --exit-code --no-ext-diff HEAD -- main\.js[\s\S]*?test -s main\.js/);
    assert.match(workflow, /Verify tracked bundle after build[\s\S]*?git ls-files --error-unmatch -- main\.js[\s\S]*?git diff --exit-code --no-ext-diff HEAD -- main\.js[\s\S]*?test -s main\.js/);
    assert.match(workflow, /npm run release:validate -- \"\$GITHUB_REF_NAME\"/);
    assert.match(workflow, /--notes-file \"\$RELEASE_NOTES_PATH\"/);
    assert.doesNotMatch(workflow, /--generate-notes/);
    assert.match(workflow, /--json body --template '\{\{\.body\}\}' > \"\$verify_directory\/release-body\.md\"/);
    assert.doesNotMatch(workflow, /--json body --jq/);
    assert.match(workflow, /cmp -s \"\$RELEASE_NOTES_PATH\" \"\$verify_directory\/release-body\.md\"/);
    assert.match(workflow, /gh release edit[\s\S]*?--draft=false \\\n\s+--prerelease=false/);
    assert.match(workflow, /gh release create[\s\S]*?--draft=false \\\n\s+--prerelease=false/);
    assert.match(workflow, /Verify published tag, body, assets, and checksums/);
    assert.match(workflow, /git ls-remote origin/);
    assert.match(workflow, /remote_tag_target/);
    assert.match(workflow, /peeled_ref/);
    assert.match(workflow, /expected_commit=\"\$\(git rev-parse HEAD\)\"/);
    assert.match(workflow, /test \"\$remote_tag_target\" = \"\$expected_commit\"/);
    assert.match(workflow, /isDraft/);
    assert.match(workflow, /isPrerelease/);
    assert.match(workflow, /publishedAt/);
    assert.match(workflow, /gh release download/);
    assert.match(workflow, /sha256sum -c/);
    assert.match(workflow, /release_assets=\(main\.js manifest\.json \"\$ZIP_PATH\"\)/);
    assert.match(workflow, /expected_entries=\(main\.js manifest\.json\)/);
  });
});
