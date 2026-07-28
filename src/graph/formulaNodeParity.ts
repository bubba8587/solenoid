// ─── Node ↔ formula parity measurement (the ONE source) ───────────────────────
// The app has two surfaces for the same functions: the node catalog and the
// expression/equation formula language. Nothing structurally connects them (a node
// op is callable in a formula only if someone registered a native impl; a formula
// name has a node only if someone built one), which is exactly why they drifted —
// see `docs/formula-node-parity.md`.
//
// This module MEASURES the drift in both directions. It is imported by two callers
// that must never disagree:
//   • `scripts/formula-node-parity.ts` — the human-readable report (regenerates the
//     numbers quoted in the doc);
//   • `formulaNodeParity.test.ts` — the RATCHET, which pins today's gaps and fails
//     CI when a new one appears.
// Keep the measurement here, not in either caller: a report that computes the gap
// differently from the test is how a ratchet silently stops ratcheting.

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
  /** Is every EXCEL name this node stands in for dispatchable? False for a node with
   *  no Excel names. Kept separate from `inFormula` on purpose: a node can be fully
   *  reachable under its Solenoid name and STILL leave its Excel spelling answering
   *  #NAME?, which is exactly what gap A is for. Folding the two together let SCAN
   *  quietly drop out of the gap the moment RUNNINGSUM was registered. */
  excelCovered: boolean;
}

// A leaf's `type` is a free-form node type, so `e.type === "category"` doesn't
// discriminate the union on its own — the same predicates AddNodeMenu uses.
/** The D19 2(a) formula name for a node label: despaced and uppercased, so
 *  "Rolling SUM" is ROLLINGSUM and "COUNT DISTINCT" is COUNTDISTINCT. The Tier 3
 *  registrations derive their names the same way, from the family OP_META tables. */
export const despace = (label: string) => label.replace(/\s+/g, "").toUpperCase();

const isCategory = (e: CatalogEntry): e is CatalogCategory => e.type === "category";
const isPair = (e: CatalogEntry): e is CatalogPair => e.type === "pair";

function walk(entries: CatalogEntry[], path: string[], out: ParityRow[], formulaNames: Set<string>): void {
  for (const e of entries) {
    if (isCategory(e)) { walk(e.children, [...path, e.label], out, formulaNames); continue; }
    if (isPair(e)) { walk(e.children, path, out, formulaNames); continue; }
    const leaf: NodeCatalogEntry = e;
    if (leaf.hidden) continue;
    const excel = (leaf.excel ?? NODE_EXCEL[leaf.type] ?? []).map((x) => x.excel.toUpperCase());
    // A Solenoid-native leaf is matched by its LABEL DESPACED — D19 decision 2(a),
    // which is how "Rolling SUM" becomes ROLLINGSUM. Without the despace this
    // under-reports every multi-word native the Tier 3 registrations cover.
    //
    // A COLLAPSED op family is a second case: its leaf label ("Pad", "Coalesce / Fill")
    // names the family, not any one function, so the leaf is covered when every OP is
    // callable — PADLEFT and PADRIGHT, not PAD. An op's formula name is its declared
    // `fx` where the label is prose, else the despaced label. Reading the host label
    // alone reported nine registered FILL* functions as a gap.
    const ops = opsFor(leaf.type)?.ops;
    const excelCovered = excel.length > 0 && excel.every((x) => formulaNames.has(x));
    const inFormula = excel.some((x) => formulaNames.has(x))
      || formulaNames.has(despace(leaf.label))
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
  /** GAP B — Solenoid-native ops with no formula name at all. Not one population:
   *  pack formulas and visual/IO nodes make parity moot; only the data-op core is
   *  meaningful (Tier 3). Not ratcheted for that reason. */
  nativeGap: ParityRow[];
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
  // A name we deliberately REGISTERED is tracked by definition, even when no node
  // claims it: the Solenoid-only natives (CLAMP/ORDINAL/BETWEEN) and the flat Excel
  // compatibility spellings we own on purpose (STDEV/VAR/MODE/PERCENTILE/…, each with
  // an Excel-correct impl behind it). Counting those as "uncurated drift" would make
  // the ratchet fight the registry — the exact work this program is doing.
  const registered = new Set(Object.keys(EXCEL_IMPL_META).map((n) => n.toUpperCase()));

  return {
    rows,
    covered: rows.filter((r) => r.inFormula),
    excelNamedGap: rows.filter((r) => r.excel.length > 0 && !r.excelCovered),
    nativeGap: rows.filter((r) => !r.inFormula && r.excel.length === 0),
    noNode,
    untracked: noNode.filter((n) => {
      const k = n.toUpperCase();
      return !gapNames.has(k) && !registered.has(k);
    }),
  };
}

/** GAP A as a flat, sorted, de-duplicated name list — the ratchet's unit. A node
 *  standing in for several names (REGEX → REGEXTEST/REGEXEXTRACT/REGEXREPLACE)
 *  contributes each name separately, so closing one of them shows up. */
export function excelNamedGapNames(m: ParityMeasurement): string[] {
  const formulaNames = new Set(formulaFunctionNames().map((n) => n.toUpperCase()));
  const out = new Set<string>();
  for (const r of m.excelNamedGap) for (const x of r.excel) if (!formulaNames.has(x)) out.add(x);
  return [...out].sort();
}
