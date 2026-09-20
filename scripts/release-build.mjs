// Release build with the builder's home path stripped (why: the NOTE in src-tauri/Cargo.toml).
//   npm run release:desktop [-- <tauri build args>]
// ENCODED flags because a home path can hold a space.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = os.homedir();
const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: `--remap-path-prefix=${home}=${WIN ? "C:\\build" : "/build"}` };

const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { cwd: root, env, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r;
};

run(process.execPath, [path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", ...process.argv.slice(2)], { stdio: "inherit" });

const meta = run("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", path.join("src-tauri", "Cargo.toml")], { encoding: "utf8", maxBuffer: 1 << 26 });
const exe = path.join(JSON.parse(meta.stdout).target_directory, "release", WIN ? "solenoid.exe" : "solenoid");
const bin = fs.readFileSync(exe);
const leaks = [home, os.userInfo().username].filter((s) => bin.includes(s));
if (leaks.length) {
  console.error(`release-build: ${exe} still contains a local path or username (${leaks.length} pattern(s) matched). Do not ship it.`);
  process.exit(1);
}
console.log(`release-build: ${exe} carries no local path.`);
