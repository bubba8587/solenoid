// [[C130]] rustCore
// A hash of a wasm module's committed Rust sources, which `npm run build:wasm` writes beside the module it builds;
// wasmStamp.test.ts recomputes it, so a Rust change without a rebuild fails. Only files git tracks count, so a
// build's own leftovers (a vendored crate's Cargo.lock) never do.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Each module's source roots: the core and the crates it vendors, and the graph engine ([[D102]] graphOnCore). */
export const MODULES = {
  core: { crate: "solenoid-core", out: "src/graph/engineWasm", roots: ["crates/solenoid-core", "crates/vendor"] },
  graph: { crate: "solenoid-graph", out: "src/graph/graphWasm", roots: ["crates/solenoid-graph"] },
};
const SKIP = /(^|\/)(tests\/|README\.md$)/;

export function sourceStamp(root = ".", module = "core") {
  // Mid-merge, ls-files lists an unmerged file once per stage.
  const listed = execFileSync("git", ["ls-files", "-z", ...MODULES[module].roots], { cwd: root }).toString().split("\0");
  const files = [...new Set(listed)].filter((f) => f && !SKIP.test(f.slice(f.indexOf("/", "crates/".length) + 1))).sort();
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f);
    h.update("\0");
    h.update(readFileSync(join(root, f)));
    h.update("\0");
  }
  return h.digest("hex");
}
