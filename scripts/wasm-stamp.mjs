// [[C130]] rustCore
// A hash of the Rust core's sources (crates/solenoid-core and the crates it vendors), which `npm run build:wasm`
// writes beside the module it builds; wasmStamp.test.ts recomputes it, so a Rust change without a rebuild fails.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["crates/solenoid-core", "crates/vendor"];
const SKIP = new Set(["target", "tests", "README.md"]);

function files(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

export function sourceStamp(root = ".") {
  const h = createHash("sha256");
  for (const r of ROOTS) for (const f of files(join(root, r))) {
    h.update(relative(root, f).replaceAll("\\", "/"));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}
