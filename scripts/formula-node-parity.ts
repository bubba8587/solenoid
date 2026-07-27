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
//
// The measurement itself lives in `src/graph/formulaNodeParity.ts`, shared with
// the RATCHET test that pins these gaps — this file is only the report.

import { measureParity, excelNamedGapNames } from "../src/graph/formulaNodeParity";
import { EXCEL_IMPL_META } from "../src/graph/excelFunctions";

const m = measureParity();

console.log(`\n=== Node → formula: ${m.covered.length}/${m.rows.length} leaves formula-callable ===`);
console.log(`\nA. Excel-named node, name NOT dispatchable in a formula (${m.excelNamedGap.length} nodes, ${excelNamedGapNames(m).length} names):`);
for (const r of m.excelNamedGap) console.log(`  ${r.excel.join("/")}  ←  ${r.label} [${r.cat}]`);

const byCat = new Map<string, string[]>();
for (const r of m.nativeGap) {
  if (!byCat.has(r.cat)) byCat.set(r.cat, []);
  byCat.get(r.cat)!.push(r.label);
}
console.log(`\nB. Solenoid-native ops, no formula equivalent (${m.nativeGap.length}), by category:`);
for (const [cat, labels] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${cat} (${labels.length}): ${labels.join(" · ")}`);
}

console.log(`\n=== Formula → node: dispatchable names with ${m.noNode.length} without a node home ===`);
console.log(`  in EXCEL_GAP (deliberate): ${m.noNode.length - m.untracked.length}`);
console.log(`\nC. Untracked — dispatchable, no node, not in the gap list (${m.untracked.length}):`);
console.log(`  ${m.untracked.join(" · ")}`);
console.log(`\nnative impls registered (EXCEL_IMPL_META): ${Object.keys(EXCEL_IMPL_META).length}\n`);
