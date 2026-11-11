// The strict validating reader (src/graph/graphValidate.ts) as a CLI, for a text-form or JSON graph.
// Prints every issue with its line anchor and exits 1 if any; silence and exit 0 mean the loader would
// apply the file with no silent repairs and the editor would accept every cable.
//   npm run validate-graph <graph.txt|graph.json> [--json]
// `--json` prints a clean graph as the JSON save in place of "OK", so a text-form file can go where a save goes
// (shot-graph asks for it); a card the sidecar gives no position is laid out by its depth in the cables.

import { readFileSync } from "node:fs";
import { isEntry } from "./entry";
import { validateText, validateGraph, formatIssues, hardIssues } from "../src/graph/graphValidate";
import type { GraphIssue } from "../src/graph/graphValidate";
import type { SavedGraph } from "../src/graph/persistence";
import { validateSavedGraph } from "../src/graph/persistenceCore";
// @ts-expect-error a plain .mjs script, untyped
import { expand } from "./shot-graph-expand.mjs";

/** Exits 1 on a hard issue, 2 on a missing file argument. */
export function main(args: string[]): void {
  const path = args[0];
  if (!path) {
    console.error("usage: npm run validate-graph <graph.txt|graph.json>");
    process.exit(2);
  }

  const raw = readFileSync(path, "utf8");
  const looksJson = raw.trimStart().startsWith("{");

  let issues: GraphIssue[];
  let saved: unknown = null;
  if (looksJson) {
    // The short form the example graphs use (no version, cards placed by their cables) is a save once expanded, as
    // run-graph and shot-graph read it.
    const parsed = JSON.parse(raw) as { v?: unknown; nodes?: unknown };
    const data = (parsed.v === undefined && Array.isArray(parsed.nodes) ? expand(parsed) : parsed) as unknown;
    const structural = validateSavedGraph(data);
    if (!structural.ok) {
      console.error(`${path}: ${structural.reason}`);
      process.exit(1);
    }
    issues = validateGraph(data as SavedGraph);
    saved = data;
  } else {
    const read = validateText(raw);
    issues = read.issues;
    if (read.graph) {
      // A file with no `---` line has no sidecar; `validateText` has already said so.
      const sep = raw.indexOf("\n---");
      let sidecar: { positions?: Record<string, unknown> } = {};
      try { if (sep >= 0) sidecar = JSON.parse(raw.slice(sep + 4).trim() || "{}"); } catch { /* reported as an issue */ }
      const placed = new Set(Object.keys(sidecar.positions ?? {}));
      saved = expand({ ...read.graph, nodes: read.graph.nodes.map((n) => (placed.has(n.name ?? n.id) ? n : { ...n, x: undefined, y: undefined })) });
    }
  }

  if (issues.length > 0) console.error(formatIssues(issues));
  const hard = hardIssues(issues);
  if (hard.length > 0) {
    console.error(`\n${path}: ${hard.length} issue${hard.length === 1 ? "" : "s"}.`);
    process.exit(1);
  }
  if (args.includes("--json")) console.log(JSON.stringify(saved, null, 1));
  else console.log(`${path}: OK${issues.length > 0 ? ` (${issues.length} warning${issues.length === 1 ? "" : "s"})` : ""}`);
}

if (isEntry("validate-graph")) main(process.argv.slice(2));
