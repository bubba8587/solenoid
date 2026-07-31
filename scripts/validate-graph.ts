// Run with: npm run validate-graph <graph.txt|graph.json>
// The strict validating reader as a CLI — the pre-apply gate for generated or
// hand-written graphs (backlog "AI command palette"; the module is
// src/graph/graphValidate.ts). Accepts either surface of the same document:
// a text-form file (the "Name: Type key=... in<-Node.out" grammar) or a saved
// JSON graph. Prints every issue with its line anchor and exits 1 if any —
// silence + exit 0 means the permissive loader would apply this file with no
// silent repairs and the live editor would accept every cable.

import { readFileSync } from "node:fs";
import { validateText, validateGraph, formatIssues, hardIssues } from "../src/graph/graphValidate";
import type { GraphIssue } from "../src/graph/graphValidate";
import type { SavedGraph } from "../src/graph/persistence";
import { validateSavedGraph } from "../src/graph/persistenceCore";

const path = process.argv[2];
if (!path) {
  console.error("usage: npm run validate-graph <graph.txt|graph.json>");
  process.exit(2);
}

const raw = readFileSync(path, "utf8");
const looksJson = raw.trimStart().startsWith("{");

let issues: GraphIssue[];
if (looksJson) {
  const data = JSON.parse(raw) as unknown;
  const structural = validateSavedGraph(data);
  if (!structural.ok) {
    console.error(`${path}: ${structural.reason}`);
    process.exit(1);
  }
  issues = validateGraph(data as SavedGraph);
} else {
  issues = validateText(raw).issues;
}

if (issues.length > 0) console.error(formatIssues(issues));
const hard = hardIssues(issues);
if (hard.length > 0) {
  console.error(`\n${path}: ${hard.length} issue${hard.length === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log(`${path}: OK${issues.length > 0 ? ` (${issues.length} warning${issues.length === 1 ? "" : "s"})` : ""}`);
