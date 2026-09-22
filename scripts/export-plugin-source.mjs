// [[C107]] obsidianPlugin
// Export the Solenoid Properties plugin's source into its own repository, which the community
// directory requires to hold the source it is built from (specs/obsidian-plugin.md § Publishing).
// This repository stays the source of truth: the plugin is built from the app's own components.
// The export is a SNAPSHOT of what the build reads and what those files import for types, laid
// out at the same paths, plus a
// package.json pinned to the versions installed here, so `npm ci && npm run build` there makes
// the same bundle with no checkout of this repository.
//
//   npm run plugin:export -- "<path to the Solenoid-Properties clone>"
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] && path.resolve(process.argv[2]);
if (!target || !fs.existsSync(path.join(target, ".git"))) {
  console.error("usage: export-plugin-source.mjs <path to the plugin repository's clone>");
  process.exit(1);
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(r.status ?? 1); }
  return r.stdout.trim();
};
const installed = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")).version;

// 1. Build once into a scratch folder to learn which source files the bundle reads.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "solenoid-plugin-export-"));
const modulesFile = path.join(scratch, "modules.json");
run(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "build", "--config", "obsidian-plugin/vite.config.ts"], {
  env: { ...process.env, PLUGIN_OUT: path.join(scratch, "dist"), PLUGIN_MODULES: modulesFile, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
});
const modules = JSON.parse(fs.readFileSync(modulesFile, "utf8"));

// 2. Replace the last snapshot: the app files the build read, and the plugin folder whole.
for (const dir of ["src", "obsidian-plugin"]) fs.rmSync(path.join(target, dir), { recursive: true, force: true });
const copy = (rel) => {
  fs.mkdirSync(path.dirname(path.join(target, rel)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), path.join(target, rel));
};
const appFiles = new Set(modules.filter((rel) => rel.startsWith("src/")));
const pluginFiles = run("git", ["ls-files", "obsidian-plugin"]).split("\n").filter(Boolean);
// The bundle drops a type-only import, and the directory's review lints WITH types: a module
// that does not resolve there types everything through it `any`. So the snapshot also takes
// what its files import for types alone. A shimmed module is not one of them: its stand-in
// answers for it (`rootDirs` below).
const shimmed = new Set(fs.readdirSync(path.join(ROOT, "obsidian-plugin/src/shims")).map((f) => `src/graph/${f}`));
const resolveApp = (from, spec) => {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => /\.tsx?$/.test(c) && fs.existsSync(path.join(ROOT, c)));
};
for (const queue = [...appFiles, ...pluginFiles].filter((f) => /\.tsx?$/.test(f)); queue.length;) {
  const file = queue.pop();
  for (const [, spec] of fs.readFileSync(path.join(ROOT, file), "utf8").matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.[^"']*)["']/g)) {
    const hit = resolveApp(file, spec);
    if (!hit || !hit.startsWith("src/") || appFiles.has(hit) || shimmed.has(hit)) continue;
    appFiles.add(hit);
    queue.push(hit);
  }
}
appFiles.add("src/vite-env.d.ts");
appFiles.forEach(copy);
pluginFiles.forEach(copy);

// 3. What the snapshot needs to build on its own.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "obsidian-plugin/manifest.json"), "utf8"));
const pin = (names) => Object.fromEntries(names.map((n) => [n, installed(n)]));
fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({
  name: manifest.id,
  version: manifest.version,
  private: true,
  type: "module",
  description: manifest.description,
  license: "MIT",
  // The typecheck is the guard on the stand-ins: the app's calls must check against them.
  scripts: { build: "tsc --noEmit && PLUGIN_OUT=dist VITE_CONFIG_NATIVE_IGNORE_WARNING=true vite build --config obsidian-plugin/vite.config.ts" },
  dependencies: pin([
    "@fontsource-variable/atkinson-hyperlegible-mono", "@fontsource-variable/atkinson-hyperlegible-next",
    "chrono-node", "papaparse", "react", "react-dom", "rete",
  ]),
  devDependencies: pin([
    "@types/papaparse", "@types/react", "@types/react-dom", "@vitejs/plugin-react", "estree-walker", "magic-string",
    "obsidian", "postcss", "rollup-plugin-license", "typescript", "vite",
  ]),
  // Vite takes any 1.2.x bundler, and a patch bump minifies React differently: pin the one
  // installed here so the snapshot makes the same bytes.
  overrides: pin(["rolldown"]),
}, null, 2) + "\n");

// tsconfig.json is JSON with comments and trailing commas.
const jsonc = (text) => JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
const ts = jsonc(fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8"));
fs.writeFileSync(path.join(target, "tsconfig.json"), JSON.stringify({
  // `rootDirs` lays the stand-ins over the app modules they replace, so `./packs` resolves to
  // `shims/packs.ts` for types as the build's swap resolves it for code.
  compilerOptions: { ...ts.compilerOptions, paths: undefined, noEmit: true, rootDirs: ["src/graph", "obsidian-plugin/src/shims"] },
  include: ["obsidian-plugin/src", "src"],
}, null, 2) + "\n");

fs.writeFileSync(path.join(target, ".gitignore"), "node_modules/\ndist/\n");
fs.copyFileSync(path.join(ROOT, "obsidian-plugin/manifest.json"), path.join(target, "manifest.json"));
fs.copyFileSync(path.join(scratch, "dist", "third-party-licenses.txt"), path.join(target, "THIRD-PARTY-LICENSES.txt"));

const versionsFile = path.join(target, "versions.json");
const versions = fs.existsSync(versionsFile) ? JSON.parse(fs.readFileSync(versionsFile, "utf8")) : {};
versions[manifest.version] = manifest.minAppVersion;
fs.writeFileSync(versionsFile, JSON.stringify(versions, null, 2) + "\n");

const dirty = run("git", ["status", "--porcelain", "--", "src", "obsidian-plugin", "package.json", "package-lock.json"]);
fs.writeFileSync(path.join(target, "source.json"), JSON.stringify({
  repo: "bubba8587/solenoid",
  ref: run("git", ["rev-parse", "HEAD"]),
  note: "The snapshot in src/ and obsidian-plugin/ was exported from this commit by scripts/export-plugin-source.mjs.",
}, null, 2) + "\n");

// 4. A lock file of its own, so `npm ci` there is reproducible.
console.log("export: resolving a package-lock.json in the target (npm install --package-lock-only)…");
run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: target });

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`export: ${appFiles.size} app files + ${pluginFiles.length} plugin files -> ${target}`);
if (dirty) console.log("export: WARNING, this working tree has uncommitted source changes; source.json names HEAD, which may not match.");
