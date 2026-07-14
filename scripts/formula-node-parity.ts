// Run with: npx tsx scripts/formula-node-parity.ts
// Measures the NODE ↔ FORMULA parity gap in both directions (author direction
// 2026-07-14: the node set and the expression/equation formula language should
// converge — see docs/formula-node-parity.md). Companion to scripts/parity.ts
// (which measures the EXCEL → Solenoid gap); this one measures Solenoid
// against itself:
//   A. catalog leaves whose Excel name is NOT dispatchable in a formula
//      (a user types TEXTSPLIT(...) in an Expression → #NAME?, node exists);
//   B. Solenoid-native node ops with no formula equivalent at all;
//   C. formula-dispatchable names with no node home and no EXCEL_GAP entry
//      (the uncurated legacy-alias surface Formula.js drags in).

import { buildCatalog } from "../src/graph/catalogUtils";
import type { CatalogEntry, NodeCatalogEntry } from "../src/graph/AddNodeMenu";
import { NODE_EXCEL, EXCEL_GAP } from "../src/graph/nodeExcel";
import { FORMULA_FUNCTION_NAMES } from "../src/graph/excelFormula";
import { EXCEL_IMPL_META } from "../src/graph/excelFunctions";

type Row = { cat: string; type: string; label: string; excel: string[]; inFormula: boolean };

function walk(entries: CatalogEntry[], path: string[], out: Row[], formulaNames: Set<string>) {
  for (const e of entries) {
    if (e.type === "category") { walk(e.children, [...path, e.label], out, formulaNames); continue; }
    if (e.type === "pair") { walk(e.children, path, out, formulaNames); continue; }
    const leaf = e as NodeCatalogEntry;
    if (leaf.hidden) continue;
    const excel = (leaf.excel ?? NODE_EXCEL[leaf.type] ?? []).map((x) => x.excel.toUpperCase());
    const inFormula = excel.some((x) => formulaNames.has(x)) || formulaNames.has(leaf.label.toUpperCase());
    out.push({ cat: path.join(" › ") || "(top)", type: leaf.type, label: leaf.label, excel, inFormula });
  }
}

const formulaNames = new Set(FORMULA_FUNCTION_NAMES.map((n) => n.toUpperCase()));
const rows: Row[] = [];
walk(buildCatalog(false), [], rows, formulaNames);

const covered = rows.filter((r) => r.inFormula);
const uncoveredMapped = rows.filter((r) => !r.inFormula && r.excel.length > 0);
const uncoveredNative = rows.filter((r) => !r.inFormula && r.excel.length === 0);

console.log(`\n=== Node → formula: ${covered.length}/${rows.length} leaves formula-callable ===`);
console.log(`\nA. Excel-named node, name NOT dispatchable in a formula (${uncoveredMapped.length}):`);
for (const r of uncoveredMapped) console.log(`  ${r.excel.join("/")}  ←  ${r.label} [${r.cat}]`);

const byCat = new Map<string, string[]>();
for (const r of uncoveredNative) {
  if (!byCat.has(r.cat)) byCat.set(r.cat, []);
  byCat.get(r.cat)!.push(r.label);
}
console.log(`\nB. Solenoid-native ops, no formula equivalent (${uncoveredNative.length}), by category:`);
for (const [cat, labels] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${cat} (${labels.length}): ${labels.join(" · ")}`);
}

const nodeExcelNames = new Set<string>();
for (const eqs of Object.values(NODE_EXCEL)) for (const x of eqs) nodeExcelNames.add(x.excel.toUpperCase());
const gapNames = new Set(EXCEL_GAP.map((g) => g.excel.toUpperCase()));
const noNode = FORMULA_FUNCTION_NAMES.filter((n) => !nodeExcelNames.has(n.toUpperCase()));
const untracked = noNode.filter((n) => !gapNames.has(n.toUpperCase()));
console.log(`\n=== Formula → node: ${FORMULA_FUNCTION_NAMES.length} dispatchable names, ${noNode.length} without a node home ===`);
console.log(`  in EXCEL_GAP (deliberate): ${noNode.length - untracked.length}`);
console.log(`\nC. Untracked — dispatchable, no node, not in the gap list (${untracked.length}):`);
console.log(`  ${untracked.join(" · ")}`);
console.log(`\nnative impls registered (EXCEL_IMPL_META): ${Object.keys(EXCEL_IMPL_META).length}\n`);
