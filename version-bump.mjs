import { readFileSync } from "node:fs";
import { syncMetadata } from "./release.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const targetVersion = packageJson.version;

if (typeof targetVersion !== "string" || targetVersion.trim().length === 0) {
  throw new Error("package.json version is missing or invalid");
}

syncMetadata({ version: targetVersion });
