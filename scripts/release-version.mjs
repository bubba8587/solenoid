// Cuts a release's version: `node scripts/release-version.mjs 1.6.1`
// - sets the app's version in package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock and
//   src-tauri/tauri.conf.json, and the app's own line in public/third-party-licenses-rust.txt (CI's license check
//   regenerates that file and fails on a stale version);
// - freezes every `NEXT_RELEASE` mark in src/graph/nodeCatalog.ts to the release (`"1.6.1"`, or `"1.7"` for 1.7.0);
// - moves NEXT_RELEASE (src/graph/release.ts) to the next x.y, the default guess for the next release; set it by
//   hand to an x.y.z when that one is a patch.
// The What's New deck (src/graph/whatsNewSlides.ts) and the Obsidian plugin's version are separate steps.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
if (!m) {
  console.error("usage: node scripts/release-version.mjs <major.minor.patch>");
  process.exit(1);
}
const [major, minor, patch] = m.slice(1).map(Number);
const release = patch === 0 ? `${major}.${minor}` : version;
const next = `${major}.${minor + 1}`;

const file = (rel) => path.join(ROOT, rel);
const edit = (rel, fn) => {
  const before = fs.readFileSync(file(rel), "utf8");
  const after = fn(before);
  if (after === before) throw new Error(`${rel}: nothing changed`);
  fs.writeFileSync(file(rel), after);
  console.log(`  ${rel}`);
};
const once = (text, re, to, rel) => {
  const hits = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))?.length ?? 0;
  if (hits !== 1) throw new Error(`${rel}: expected one match of ${re}, found ${hits}`);
  return text.replace(re, to);
};

console.log(`Solenoid ${version} (cards tagged ${release}; next release guessed as ${next})`);
edit("package.json", (s) => once(s, /^(  "version": )"[^"]*"/m, `$1"${version}"`, "package.json"));
edit("package-lock.json", (s) => {
  const j = JSON.parse(s);
  j.version = version;
  j.packages[""].version = version;
  return JSON.stringify(j, null, 2) + "\n";
});
edit("src-tauri/tauri.conf.json", (s) => once(s, /^(  "version": )"[^"]*"/m, `$1"${version}"`, "tauri.conf.json"));
edit("src-tauri/Cargo.toml", (s) => once(s, /(\[package\]\nname = "solenoid"\nversion = )"[^"]*"/, `$1"${version}"`, "Cargo.toml"));
edit("src-tauri/Cargo.lock", (s) => once(s, /(\[\[package\]\]\nname = "solenoid"\nversion = )"[^"]*"/, `$1"${version}"`, "Cargo.lock"));
edit("public/third-party-licenses-rust.txt", (s) => {
  const re = /(?<=[:,] )solenoid \d+\.\d+\.\d+(?=[,\n])/g;
  if (!re.test(s)) throw new Error("third-party-licenses-rust.txt: no `solenoid x.y.z` to bump; run node scripts/rust-licenses.mjs");
  return s.replace(re, `solenoid ${version}`);
});

const catalog = "src/graph/nodeCatalog.ts";
const marks = (fs.readFileSync(file(catalog), "utf8").match(/\b(added|updated): NEXT_RELEASE\b/g) ?? []).length;
if (marks) {
  edit(catalog, (s) => {
    s = s.replace(/\b(added|updated): NEXT_RELEASE\b/g, `$1: "${release}"`);
    if (!/\bNEXT_RELEASE\b/.test(s.replace(/^import .*$/gm, ""))) s = s.replace(/^import \{ NEXT_RELEASE \} from "\.\/release";\n/m, "");
    return s;
  });
}
console.log(`  ${marks} card mark(s) frozen to "${release}"`);
edit("src/graph/release.ts", (s) => once(s, /(export const NEXT_RELEASE: Release = )"[^"]*"/, `$1"${next}"`, "release.ts"));
