import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifestPath = "manifest.json";
const versionsPath = "versions.json";
const targetVersion = packageJson.version;

if (typeof targetVersion !== "string" || targetVersion.trim().length === 0) {
  throw new Error("package.json version is missing or invalid");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = targetVersion;

const minAppVersion = typeof manifest.minAppVersion === "string" ? manifest.minAppVersion.trim() : "";
const versions = existsSync(versionsPath) ? JSON.parse(readFileSync(versionsPath, "utf8")) : {};

if (minAppVersion) {
  versions[targetVersion] = minAppVersion;
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
writeFileSync(versionsPath, `${JSON.stringify(versions, null, "\t")}\n`);

const filesToStage = ["package.json", "package-lock.json", manifestPath, versionsPath, "main.js"];
if (existsSync("styles.css")) {
  filesToStage.push("styles.css");
}

execFileSync("git", ["add", ...filesToStage], { stdio: "inherit" });
