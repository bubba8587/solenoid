// Prints the AI grounding spec (src/graph/aiGrounding.ts, which also feeds the palette's system prompt).
//   npm run ai-grounding [-- --out <file>]

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
