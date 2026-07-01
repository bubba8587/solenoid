// Run with: npx tsx scripts/parity.ts
// Lists Excel functions Solenoid genuinely doesn't have yet — the Excel-only gap,
// minus entries intentionally out of scope (cell refs, OLAP, web, superseded
// classics) and minus ones achievable by composing nodes (Filter → Reduce, etc.).
// The gap self-heals: once a function is node-backed it leaves this list.

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
