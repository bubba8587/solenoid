// [[C51]] formulaNaming, [[C14]] currentExcelParity
// Derived from NODE_EXCEL, never hand-edited: declare an equivalence there and both maps follow.

import { NODE_EXCEL } from "./nodeExcel";

export const EXCEL_TO_CATALOG: Record<string, string> = {};

export const CATALOG_TO_EXCEL: Map<string, string[]> = new Map();

for (const [type, equivs] of Object.entries(NODE_EXCEL)) {
  for (const eq of equivs) {
    EXCEL_TO_CATALOG[eq.excel] = type;
    const arr = CATALOG_TO_EXCEL.get(type) ?? [];
    arr.push(eq.excel);
    CATALOG_TO_EXCEL.set(type, arr);
  }
}
