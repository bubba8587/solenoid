// [[D7]] oneMetricImpl, [[D9]] useEveryNotSome, [[D4]] noManualList
import { buildCatalog } from "./catalogUtils";
import type { CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry } from "./AddNodeMenu";
import { NODE_EXCEL, EXCEL_GAP } from "./nodeExcel";
import { formulaFunctionNames } from "./excelFormula";
import { EXCEL_IMPL_META } from "./excelFunctions";
import { opsFor } from "./nodeOps";

export interface ParityRow {
  cat: string;
  type: string;
  label: string;
  excel: string[];
  inFormula: boolean;
  excelCovered: boolean;
}

export const despace = (label: string) => label.replace(/\s+/g, "").toUpperCase();

export function excelCoverage(excel: string[], dispatches: (name: string) => boolean): boolean {
  return excel.length > 0 && excel.every(dispatches);
}

const LANGUAGE_LEAVES = new Set([
  "arith-add", "arith-sub", "arith-mul", "arith-div", "comparison", "expression", "equation",
]);

function isPresetFormula(leaf: NodeCatalogEntry): boolean {
  try {
    const inst = leaf.create() as { expr?: unknown; locked?: unknown };
    return typeof inst?.expr === "string" && inst.expr.length > 0 && inst.locked === true;
  } catch {
    return false;
  }
}

const isCategory = (e: CatalogEntry): e is CatalogCategory => e.type === "category";
const isPair = (e: CatalogEntry): e is CatalogPair => e.type === "pair";

function walk(entries: CatalogEntry[], path: string[], out: ParityRow[], formulaNames: Set<string>): void {
  for (const e of entries) {
    if (isCategory(e)) { walk(e.children, [...path, e.label], out, formulaNames); continue; }
    if (isPair(e)) { walk(e.children, path, out, formulaNames); continue; }
    const leaf: NodeCatalogEntry = e;
    if (leaf.hidden) continue;
    const excel = (leaf.excel ?? NODE_EXCEL[leaf.type] ?? []).map((x) => x.excel.toUpperCase());
    const decl = opsFor(leaf.type);
    const ops = decl?.ops;
    const excelCovered = excelCoverage(excel, (x) => formulaNames.has(x));
    const inFormula = excel.some((x) => formulaNames.has(x))
      || formulaNames.has(despace(leaf.label))
      || (leaf.fx !== undefined && leaf.fx.length > 0
          && leaf.fx.every((n) => formulaNames.has(n.toUpperCase())))
      || LANGUAGE_LEAVES.has(leaf.type)
      || isPresetFormula(leaf)
      || (ops !== undefined && ops.length > 0
          && ops.every((o) => formulaNames.has(o.fx ?? despace(o.label))));
    out.push({ cat: path.join(" › ") || "(top)", type: leaf.type, label: leaf.label, excel, inFormula, excelCovered });
  }
}

export interface ParityMeasurement {
  rows: ParityRow[];
  covered: ParityRow[];
  excelNamedGap: ParityRow[];
  nativeGap: ParityRow[];
  inScope: ParityRow[];
  noNode: string[];
  untracked: string[];
}

export function measureParity(): ParityMeasurement {
  const formulaNames = new Set(formulaFunctionNames().map((n) => n.toUpperCase()));
  const rows: ParityRow[] = [];
  walk(buildCatalog(false), [], rows, formulaNames);

  const nodeExcelNames = new Set<string>();
  for (const eqs of Object.values(NODE_EXCEL)) for (const x of eqs) nodeExcelNames.add(x.excel.toUpperCase());
  const gapNames = new Set(EXCEL_GAP.map((g) => g.excel.toUpperCase()));
  const noNode = formulaFunctionNames().filter((n) => !nodeExcelNames.has(n.toUpperCase()));
  const registered = new Set(Object.keys(EXCEL_IMPL_META).map((n) => n.toUpperCase()));

  return {
    rows,
    covered: rows.filter((r) => r.inFormula),
    excelNamedGap: rows.filter((r) => r.excel.length > 0 && !r.excelCovered),
    nativeGap: rows.filter((r) => !r.inFormula && r.excel.length === 0),
    inScope: rows.filter((r) => r.inFormula || r.excel.length > 0),
    noNode,
    untracked: noNode.filter((n) => {
      const k = n.toUpperCase();
      return !gapNames.has(k) && !registered.has(k);
    }),
  };
}

export function excelNamedGapNames(m: ParityMeasurement): string[] {
  const formulaNames = new Set(formulaFunctionNames().map((n) => n.toUpperCase()));
  const out = new Set<string>();
  for (const r of m.excelNamedGap) for (const x of r.excel) if (!formulaNames.has(x)) out.add(x);
  return [...out].sort();
}
