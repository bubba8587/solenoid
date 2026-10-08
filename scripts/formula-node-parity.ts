// Reports the node-to-formula parity gap (the measurement is src/graph/formulaNodeParity.ts, shared with
// the ratchet test): A, Excel-named nodes whose name a formula can't call; B, native node ops with no
// formula equivalent; C, formula names with no node and no EXCEL_GAP entry. scripts/parity.ts is Excel's gap.
//   npx tsx scripts/formula-node-parity.ts

import { measureParity, excelNamedGapNames } from "../src/graph/formulaNodeParity";
import { EXCEL_IMPL_META } from "../src/graph/excelFunctions";
import { initPackFormulas } from "../src/graph/formulaExtensions";

// Register pack formulas first, as main.tsx does, or pack nodes report as false gaps.
initPackFormulas();

const m = measureParity();

const pct = m.inScope.length ? Math.round((m.covered.length / m.inScope.length) * 1000) / 10 : 100;
console.log(`\n=== Node → formula: ${m.covered.length}/${m.inScope.length} in-scope leaves callable (${pct}%) ===`);
console.log(`    excluded by design: ${m.nativeGap.length} non-function leaves (sources · sinks · UI · chrome · the verb surface) — gap B below`);
console.log(`    catalog total: ${m.rows.length} leaves`);
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
