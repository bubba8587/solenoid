// [[C130]] rustCore
// The committed wasm module is built from the committed Rust: `npm run build:wasm` stamps the sources it built.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
// @ts-expect-error a plain .mjs script, untyped
import { MODULE, sourceStamp } from "../../scripts/wasm-stamp.mjs";

it("the module is current with the crates it links (run npm run build:wasm)", () => {
  const root = path.resolve(__dirname, "../..");
  const stamped = fs.readFileSync(path.join(root, (MODULE as { out: string }).out, "source-stamp.txt"), "utf8").trim();
  expect(stamped).toBe(sourceStamp(root));
});
