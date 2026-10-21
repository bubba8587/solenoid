// [[C130]] rustCore
// The committed wasm module is built from the committed Rust: `npm run build:wasm` stamps the sources it built.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
// @ts-expect-error a plain .mjs script, untyped
import { sourceStamp } from "../../scripts/wasm-stamp.mjs";

it("the wasm module is current with crates/solenoid-core (run npm run build:wasm)", () => {
  const root = path.resolve(__dirname, "../..");
  const stamped = fs.readFileSync(path.join(root, "src/graph/engineWasm/source-stamp.txt"), "utf8").trim();
  expect(stamped).toBe(sourceStamp(root));
});
