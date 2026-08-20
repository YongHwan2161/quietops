import { spawnSync } from "node:child_process";

const [major, minor] = process.versions.node
  .split(".", 2)
  .map((value) => Number.parseInt(value, 10));

if (major === undefined || minor === undefined || Number.isNaN(major + minor)) {
  throw new Error(`Unable to parse Node.js version ${process.versions.node}.`);
}

if (major < 22 || (major === 22 && minor < 5)) {
  throw new Error("QuietOps SQLite requires Node.js 22.5.0 or later.");
}

const sqliteFlags = major === 22 && minor < 13 ? ["--experimental-sqlite"] : [];
const result = spawnSync(
  process.execPath,
  [...sqliteFlags, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
