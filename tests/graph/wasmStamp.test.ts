// [[C130]] rustCore
// The committed wasm modules are built from the committed Rust: `npm run build:wasm` stamps the sources it built.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
// @ts-expect-error a plain .mjs script, untyped
import { MODULES, sourceStamp } from "../../scripts/wasm-stamp.mjs";

for (const [name, { crate, out }] of Object.entries(MODULES as Record<string, { crate: string; out: string }>)) {
  it(`the ${name} module is current with crates/${crate} (run npm run build:wasm)`, () => {
    const root = path.resolve(__dirname, "../..");
    const stamped = fs.readFileSync(path.join(root, out, "source-stamp.txt"), "utf8").trim();
    expect(stamped).toBe(sourceStamp(root, name));
  });
}
