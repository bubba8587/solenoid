// Node ↔ formula parity measurement, shared by the report script and the ratchet
// test — keep it here, or the two compute the gap differently and stop ratcheting.

import { buildCatalog } from "./catalogUtils";
import type { CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry } from "./AddNodeMenu";
import { NODE_EXCEL, EXCEL_GAP } from "./nodeExcel";
import { formulaFunctionNames } from "./excelFormula";
import { EXCEL_IMPL_META } from "./excelFunctions";
import { opsFor } from "./nodeOps";

export interface ParityRow {
  /** Add-menu path, " › "-joined. */
  cat: string;
  type: string;
  label: string;
  /** The Excel name(s) this node stands in for, UPPERCASE. Empty = Solenoid-native. */
  excel: string[];
  /** Is any of those names (or the node's own label / ops) callable in a formula? */
  inFormula: boolean;
  /** Is every EXCEL name this node stands in for dispatchable? Separate from
   *  `inFormula`: a Solenoid-reachable node can still answer #NAME? in Excel spelling. */
  excelCovered: boolean;
}

/** The formulaNaming 2(a) formula name for a node label: despaced and uppercased; the Tier 3
 *  registrations derive their names the same way. */
export const despace = (label: string) => label.replace(/\s+/g, "").toUpperCase();

/** useEveryNotSome: a node claiming Excel names is covered only when EVERY one dispatches;
 *  empty claims are never covered (vacuous ≠ complete). */
export function excelCoverage(excel: string[], dispatches: (name: string) => boolean): boolean {
  return excel.length > 0 && excel.every(dispatches);
}

// Leaves the LANGUAGE itself covers: the operator nodes, Comparison, and the two
// formula HOSTS (Expression/Equation ARE the surface being measured).
const LANGUAGE_LEAVES = new Set([
  "arith-add", "arith-sub", "arith-mul", "arith-div", "comparison", "expression", "equation",
]);

/** A PRESET-FORMULA leaf (a locked ExpressionNode): its formula equivalent is its
 *  own expr, so it counts as covered. Detected mechanically, never listed (noManualList). */
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
    // An op family's leaf label names the family, so it is covered when every OP is
    // callable. Argument families are not in NODE_OPS (rules opArgDistinct), so an
    // aggregator VALUE like Group By's SUM never counts GROUPBY as callable.
    const decl = opsFor(leaf.type);
    const ops = decl?.ops;
    const excelCovered = excelCoverage(excel, (x) => formulaNames.has(x));
    const inFormula = excel.some((x) => formulaNames.has(x))
      || formulaNames.has(despace(leaf.label))
      // A leaf-level `fx` names the function(s) the despaced label can't; covered
      // when ALL are dispatchable, like an op family.
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
  /** Every visible catalog leaf. */
  rows: ParityRow[];
  /** Leaves reachable from a formula by name. */
  covered: ParityRow[];
  /** GAP A — an Excel-named node whose name is NOT dispatchable. Typing it in an
   *  Expression gives #NAME? while the node sits in the Add menu. */
  excelNamedGap: ParityRow[];
  /** GAP B — Solenoid-native ops with no formula name; not one population (visual/IO
   *  nodes make parity moot), so it is not ratcheted. */
  nativeGap: ParityRow[];
  /** Leaves IN SCOPE for a formula name — the denominator a coverage claim must use;
   *  `rows.length` counts leaves (Slider, Note) that were never candidates. */
  inScope: ParityRow[];
  /** Dispatchable names with no node home. */
  noNode: string[];
  /** GAP C — dispatchable, no node, no EXCEL_GAP entry, and not a deliberately
   *  registered native either: the uncurated surface Formula.js drags in. */
  untracked: string[];
}

/** Measure both directions against the CURRENT catalog + formula registry. */
export function measureParity(): ParityMeasurement {
  const formulaNames = new Set(formulaFunctionNames().map((n) => n.toUpperCase()));
  const rows: ParityRow[] = [];
  walk(buildCatalog(false), [], rows, formulaNames);

  const nodeExcelNames = new Set<string>();
  for (const eqs of Object.values(NODE_EXCEL)) for (const x of eqs) nodeExcelNames.add(x.excel.toUpperCase());
  const gapNames = new Set(EXCEL_GAP.map((g) => g.excel.toUpperCase()));
  const noNode = formulaFunctionNames().filter((n) => !nodeExcelNames.has(n.toUpperCase()));
  // A deliberately REGISTERED name is tracked even with no node claiming it; counting
  // those as uncurated drift would make the ratchet fight the registry.
  const registered = new Set(Object.keys(EXCEL_IMPL_META).map((n) => n.toUpperCase()));

  return {
    rows,
    covered: rows.filter((r) => r.inFormula),
    excelNamedGap: rows.filter((r) => r.excel.length > 0 && !r.excelCovered),
    nativeGap: rows.filter((r) => !r.inFormula && r.excel.length === 0),
    // The complement of nativeGap, from the same predicate, so no leaf is double- or
    // un-counted.
    inScope: rows.filter((r) => r.inFormula || r.excel.length > 0),
    noNode,
    untracked: noNode.filter((n) => {
      const k = n.toUpperCase();
      return !gapNames.has(k) && !registered.has(k);
    }),
  };
}

/** GAP A as a flat, sorted, de-duplicated NAME list — the ratchet's unit, so closing
 *  one name of a multi-name node shows up. */
export function excelNamedGapNames(m: ParityMeasurement): string[] {
  const formulaNames = new Set(formulaFunctionNames().map((n) => n.toUpperCase()));
  const out = new Set<string>();
  for (const r of m.excelNamedGap) for (const x of r.excel) if (!formulaNames.has(x)) out.add(x);
  return [...out].sort();
}
