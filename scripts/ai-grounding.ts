// Run with: npm run ai-grounding [-- --out <file>]
// CLI shell over the grounding-spec emitter (src/graph/aiGrounding.ts — one
// emission, two consumers: this CLI and the palette's system prompt). Prints
// to stdout; `--out` writes a file instead.

import { writeFileSync } from "node:fs";
import { buildGroundingSpec } from "../src/graph/aiGrounding";

const text = buildGroundingSpec();
const outIdx = process.argv.indexOf("--out");
if (outIdx !== -1 && process.argv[outIdx + 1]) {
  writeFileSync(process.argv[outIdx + 1], text);
  console.error(`wrote ${process.argv[outIdx + 1]} (${text.length} chars)`);
} else {
  console.log(text);
}
