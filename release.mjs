import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readOutput(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

const packageJson = readJson("package.json");
const manifest = readJson("manifest.json");
const version = packageJson.version;

if (typeof version !== "string" || version.trim().length === 0) {
  throw new Error("package.json version is missing or invalid");
}

if (manifest.version !== version) {
  throw new Error(`manifest.json version (${manifest.version}) does not match package.json version (${version})`);
}

const branch = readOutput("git", ["branch", "--show-current"]);
if (!branch) {
  throw new Error("Cannot release from a detached HEAD");
}

run("git", ["push", "origin", branch, "--follow-tags"]);

const assets = ["main.js", "manifest.json"];
if (existsSync("styles.css")) {
  assets.push("styles.css");
}

run("gh", [
  "release",
  "create",
  version,
  ...assets,
  "--verify-tag",
  "--generate-notes",
  "--title",
  version
]);
