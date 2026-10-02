// Build an NSIS installer stamped with a version of its own, for testing.
//
// Installing the same version twice makes the installer offer a repair rather
// than run the upgrade an update would, so every test build gets the next
// number after the development version: 0.10.0-dev.1, then .2, and so on. The
// stamp only reaches the build through --config and nothing in the tree moves,
// so there is nothing to put back after the tests. The counter lives under
// .git and starts again from 1 whenever the version in tauri.conf.json changes.
//
// The updater artifacts are left out: they need the release signing key, and
// a test build is never published.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = join(import.meta.dirname, "..");
const base = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).version;

const gitDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
const counterFile = resolve(root, gitDir, "talk-test-installer.json");

let counter = { base, last: 0 };
if (existsSync(counterFile)) {
  const saved = JSON.parse(readFileSync(counterFile, "utf8"));
  if (saved.base === base) counter = saved;
}
counter.last += 1;

// A released version has no suffix to extend, and semver orders 0.9.0-1 before
// 0.9.0, so a test build of one would install as a downgrade.
if (!base.includes("-")) {
  console.error(`tauri.conf.json says ${base}, a released version. Open the next -dev version first.`);
  process.exit(1);
}

const version = `${base}.${counter.last}`;
// Through a file: JSON on the command line goes through cmd and the batch
// file's %*, and its quotes do not survive the trip.
const configFile = resolve(root, gitDir, "talk-test-installer.conf.json");
writeFileSync(configFile, JSON.stringify({ version, bundle: { createUpdaterArtifacts: false } }));
console.log(`Building the test installer ${version}`);

const build = spawnSync("cmd", ["/c", "scripts\\vcenv.bat", "tauri", "build", "--config", configFile], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

// Only a build that went through takes the number, so a failed one is retried
// under the same version rather than leaving a gap.
writeFileSync(counterFile, JSON.stringify(counter, null, 2) + "\n");
console.log(`Installer ${version} is under the target directory, in release/bundle/nsis`);
