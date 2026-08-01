// Run with: npm run ai-prompt -- "<prompt>" [doc.txt] [--out new.txt]
// The palette's EXACT authoring loop, from a terminal: same service module,
// same system prompt, same validator gate and repair rounds (`aiService.ts`) —
// so the first real-key end-to-end run doesn't need the UI, and a regression in
// the loop can be reproduced headlessly. Reads the key from ANTHROPIC_API_KEY.
//
// The doc argument is a text-form file (omit for an empty document). An
// answer prints as prose; a rewrite prints as a line diff and, with --out,
// writes the new text form (runnable via `npm run run-graph`).

import { readFileSync, writeFileSync } from "node:fs";
import { apiKeyStore } from "../src/graph/apiKeyStore";
import { AI_PROVIDER } from "../src/graph/aiKey";
import { runAiPrompt } from "../src/graph/aiService";
import { diffLines } from "../src/graph/textDiff";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outFile = outIdx !== -1 ? args[outIdx + 1] : null;
const positional = args.filter((a, i) => a !== "--out" && (outIdx === -1 || i !== outIdx + 1));
const prompt = positional[0];
const docFile = positional[1];

if (!prompt) {
  console.error('usage: npm run ai-prompt -- "<prompt>" [doc.txt] [--out new.txt]');
  process.exit(2);
}
const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(2);
}
apiKeyStore.set(AI_PROVIDER, key);

const currentText = docFile ? readFileSync(docFile, "utf8") : "---\n{ \"v\": 2 }\n";

const outcome = await runAiPrompt(prompt, currentText);
if (outcome.kind === "answer") {
  console.log(outcome.text);
} else if (outcome.kind === "edit") {
  for (const line of diffLines(currentText, outcome.newText)) {
    const mark = line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  ";
    console.log(mark + line.text);
  }
  for (const warning of outcome.warnings) console.error(`warning: ${warning}`);
  if (outFile) {
    writeFileSync(outFile, outcome.newText);
    console.error(`wrote ${outFile}`);
  }
} else {
  console.error(outcome.message);
  process.exit(1);
}
