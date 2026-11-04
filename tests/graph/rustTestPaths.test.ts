// [[D99]] rustIsSpec
// A Rust test finds its fixtures from the crate's folder as `cargo test` sets it when the test runs, never as it was
// when the binary was built: scripts/check-rust.sh shares one build directory across checkouts and worktrees, and
// cargo reuses a test binary built in another checkout, so a compile-time path reads that checkout's fixtures, or a
// folder that is gone.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function rustFiles(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "target" || e.name === "vendor") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) rustFiles(p, out);
    else if (e.name.endsWith(".rs")) out.push(p);
  }
  return out;
}

it("no Rust test reads the crate's folder as it was at build time", () => {
  const baked = rustFiles(path.join(ROOT, "crates"), [])
    .filter((f) => fs.readFileSync(f, "utf8").includes('env!("CARGO_MANIFEST_DIR")'))
    .map((f) => path.relative(ROOT, f));
  expect(baked, 'read std::env::var("CARGO_MANIFEST_DIR") at run time instead').toEqual([]);
});
