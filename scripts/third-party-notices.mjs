// Writes src/assets/third-party-notices.txt: the licence notice of every production dependency,
// npm and Rust, that MIT, BSD and Apache ask to travel with a copy of the software.
//
//   bun run notices          rewrite the file
//   bun run notices --check  fail when the committed file is out of date
//
// Packages that ship the same notice text are grouped under it, so the file stays readable.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src", "assets", "third-party-notices.txt");
const NOTICE_FILE = /^(licen[sc]e|copying|notice|unlicense)([-_.].*)?$/i;

/** The notice files a package folder carries, as one text, or an empty string. */
function noticeText(dir) {
  if (!existsSync(dir)) return "";
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && NOTICE_FILE.test(e.name) && !/\.(js|mjs|cjs|ts|json|rs)$/i.test(e.name))
    .map((e) => e.name)
    .sort();
  return names
    .map((n) => readFileSync(join(dir, n), "utf8").replace(/\r\n/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Crates that compile a C or C++ project inside themselves, with the folder holding its notice. */
const BUNDLED = { "whisper-rs-sys": "whisper.cpp" };

/** Production npm packages reachable from package.json, resolved the way node resolves them. */
function npmPackages() {
  const found = new Map();
  const walk = (dir, names) => {
    for (const name of names) {
      let at = dir;
      let pkgDir = null;
      for (;;) {
        const candidate = join(at, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) {
          pkgDir = candidate;
          break;
        }
        const up = dirname(at);
        if (up === at) break;
        at = up;
      }
      if (!pkgDir) continue; // an optional dependency of another platform
      const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
      const key = `${pkg.name}@${pkg.version}`;
      if (found.has(key)) continue;
      const licence = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "see package");
      found.set(key, { name: pkg.name, version: pkg.version, licence, text: noticeText(pkgDir) });
      walk(pkgDir, Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }));
    }
  };
  const top = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  walk(root, Object.keys(top.dependencies));
  return [...found.values()];
}

/** The notice of a crate, followed by the one of the C or C++ project it compiles, if any. */
function crateText(p) {
  const dir = dirname(p.manifest_path);
  const bundled = BUNDLED[p.name];
  const inner = bundled ? noticeText(join(dir, bundled)) : "";
  return [noticeText(dir), inner && `${bundled}, compiled into this crate:\n\n${inner}`]
    .filter(Boolean)
    .join("\n\n");
}

/** Rust crates linked into the application on any platform, build-only and dev-only ones left out. */
function rustPackages() {
  const raw = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--filter-platform", "x86_64-pc-windows-msvc", "--filter-platform", "x86_64-unknown-linux-gnu", "--manifest-path", join(root, "src-tauri", "Cargo.toml")],
    { maxBuffer: 1 << 28 },
  );
  const meta = JSON.parse(raw.toString("utf8"));
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((k) => k.kind === null)) visit(dep.pkg);
    }
  };
  visit(meta.resolve.root);
  return [...seen]
    .filter((id) => id !== meta.resolve.root)
    .map((id) => byId.get(id))
    .filter((p) => p.source)
    .map((p) => ({
      name: p.name,
      version: p.version,
      licence: p.license ?? "see package",
      source: p.repository ?? "",
      text: crateText(p),
    }));
}

/** Groups packages by identical notice text, the most shared text first. */
function section(title, packages) {
  const groups = new Map();
  for (const p of packages) {
    const key = p.text || `(no licence file in the published package; licence ${p.licence}${p.source ? `; source ${p.source}` : ""})`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const body = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([text, list]) => {
      const names = list
        .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
        .map((p) => `${p.name} ${p.version} (${p.licence})`)
        .join("\n");
      return `${names}\n\n${text}`;
    })
    .join(`\n\n${"-".repeat(72)}\n\n`);
  return `${"=".repeat(72)}\n${title}\n${"=".repeat(72)}\n\n${body}\n`;
}

const text = [
  "Talk is built on the open-source projects below. Their licences require that this notice",
  "travels with the application. Talk's own licence is MIT, in the LICENSE file of the repository.",
  "",
  "Generated by scripts/third-party-notices.mjs. Do not edit by hand.",
  "",
  section("Rust crates", rustPackages()),
  section("npm packages", npmPackages()),
].join("\n");

if (process.argv.includes("--check")) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== text) {
    console.error("third-party-notices.txt is out of date: run `bun run notices`.");
    process.exit(1);
  }
} else {
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
