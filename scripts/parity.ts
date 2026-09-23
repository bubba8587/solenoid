// Lists the Excel functions Solenoid lacks, minus those out of scope (cell refs, OLAP, web, superseded
// classics) and those reachable by composing nodes. A function leaves the list once a node backs it.
//   npx tsx scripts/parity.ts

import { EXCEL_GAP } from "../src/graph/nodeExcel";

const planned = EXCEL_GAP.filter((g) => !g.oos && !g.composition);

const byCategory: Record<string, { excel: string; note?: string }[]> = {};
for (const g of planned) {
  (byCategory[g.category] ??= []).push({ excel: g.excel, note: g.note });
}

console.log(`\n=== ${planned.length} unimplemented Excel functions (of ${EXCEL_GAP.length} not node-backed) ===\n`);
for (const [cat, fns] of Object.entries(byCategory)) {
  console.log(`${cat}:`);
  for (const { excel, note } of fns) {
    console.log(`  ${excel}${note ? `  — ${note}` : ""}`);
  }
  console.log();
}
