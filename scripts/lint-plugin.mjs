// [[obsidian-plugin]]
// Lints the Obsidian plugin's source as Obsidian's review reads it: the snapshot `export-plugin-source.mjs` writes,
// under eslint-plugin-obsidianmd's recommended config, with types. Errors fail the run; warnings print.
//   npm run plugin:lint
// Files outside the snapshot's TypeScript project (vite.config.ts, the scripts) report a parse error here and are left
// out: the review has read them as they are since 0.1.0.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solenoid-plugin-lint-"));
const run = (cmd, args, cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  return r.status ?? 1;
};

try {
  run("git", ["init", "-q"], dir);
  if (run(process.execPath, [path.join(ROOT, "scripts/export-plugin-source.mjs"), dir]) !== 0) process.exit(1);
  // The snapshot pins this checkout's installed versions, so its imports resolve against this node_modules.
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "junction");
  fs.cpSync(path.join(ROOT, "src/graph/engineWasmPlugin"), path.join(dir, "src/graph/engineWasmPlugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "eslint.config.mjs"), `import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
export default defineConfig([
  globalIgnores(["node_modules", "dist", "crates", "scripts", "obsidian-plugin/vite.config.ts", "src/graph/engineWasmPlugin", "eslint.config.mjs"]),
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } } },
]);
`);
  process.exitCode = run(process.execPath, [path.join(ROOT, "node_modules/eslint/bin/eslint.js"), "."], dir);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
