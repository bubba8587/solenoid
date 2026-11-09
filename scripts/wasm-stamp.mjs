// [[C130]] rustCore
// A hash of the wasm module's committed Rust sources, which `npm run build:wasm` writes beside the module it builds;
// wasmStamp.test.ts recomputes it, so a Rust change without a rebuild fails. Only files git tracks count, and no test or Markdown file (neither changes the module), so a
// build's own leftovers (a vendored crate's Cargo.lock) never do.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The one module: the graph engine, which links the core and the crates it vendors. */
export const MODULE = { crate: "solenoid-graph", out: "src/graph/engineWasm", roots: ["crates/solenoid-graph", "crates/solenoid-core", "crates/solenoid-schedule", "crates/vendor"] };
const SKIP = /(^|\/)(tests\/|[^/]*\.md$)/;

/** The tracked files the module is built from, sorted. */
export function sourceFiles(root = ".") {
  // Mid-merge, ls-files lists an unmerged file once per stage.
  const listed = execFileSync("git", ["ls-files", "-z", ...MODULE.roots], { cwd: root }).toString().split("\0");
  return [...new Set(listed)].filter((f) => f && !SKIP.test(f.slice(f.indexOf("/", "crates/".length) + 1))).sort();
}

export function sourceStamp(root = ".") {
  const h = createHash("sha256");
  for (const f of sourceFiles(root)) {
    h.update(f);
    h.update("\0");
    h.update(readFileSync(join(root, f)));
    h.update("\0");
  }
  return h.digest("hex");
}
