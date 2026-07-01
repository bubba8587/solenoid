// Excel function name ↔ catalog type maps. DERIVED from NODE_EXCEL — each node
// declares its own Excel equivalence in one place (nodeExcel.ts, or inline `excel`
// on a pack entry). Don't hand-edit these; add the metadata to the node and both
// maps update automatically. Used by the Add menu (Excel-name search) and the
// dev catalog validator.

import { NODE_EXCEL } from "./nodeExcel";

/** Excel function name → catalog type. */
export const EXCEL_TO_CATALOG: Record<string, string> = {};

/** catalog type → all Excel function names that map to it. */
export const CATALOG_TO_EXCEL: Map<string, string[]> = new Map();

for (const [type, equivs] of Object.entries(NODE_EXCEL)) {
  for (const eq of equivs) {
    EXCEL_TO_CATALOG[eq.excel] = type;
    const arr = CATALOG_TO_EXCEL.get(type) ?? [];
    arr.push(eq.excel);
    CATALOG_TO_EXCEL.set(type, arr);
  }
}
