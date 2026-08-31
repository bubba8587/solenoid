// Sits between the value-layer `ColumnUnit` (unitValue.ts) and the FC unit ids
// (unitBridge.ts). Pure — no React/Rete.

import { type ColumnUnit, fromUnit, tagDim, isUnitCell, sameColumnUnit } from "./unitValue";
import { fcUnitToUnit, displayMagnitudeOf } from "./unitBridge";
import { formatDim } from "./dimension";

// Currency symbol → FC unit id (the header spec "$0.00" means the currency $).
const CURRENCY_SYMBOL: Record<string, string> = { "$": "usd", "€": "eur", "£": "gbp", "¥": "jpy" };

/** Splits a `Name (spec)` header; a missing or non-dimensional spec leaves the
 *  trimmed name alone. */
export function parseColumnUnitFromHeader(header: string): { clean: string; unit?: ColumnUnit } {
  const name = (header ?? "").trim();
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
  if (!m) return { clean: name };
  const clean = m[1].trim();
  const spec = m[2].trim();
  const cu = columnUnitFromSpec(spec);
  return cu ? { clean: clean || name, unit: cu } : { clean: name };
}

/** Resolve a header/FC unit spec ("$0.00", "km", "m/s") to a `ColumnUnit`, or null
 *  when it names no dimensional unit. */
export function columnUnitFromSpec(spec: string): ColumnUnit | null {
  const s = spec.trim();
  for (const [sym, id] of Object.entries(CURRENCY_SYMBOL)) {
    if (s.includes(sym)) {
      const u = fcUnitToUnit(id)!;
      return { dim: u.dim, display: id };
    }
  }
  // A unit token: strip number-format punctuation ("0.00", "#,##0") to leave the
  // unit symbol, but KEEP `/`, `^`, letters, `%` (m/s, m^2, %).
  const token = s.replace(/[0#,.\s]/g, "");
  if (token === "") return null;
  const u = fcUnitToUnit(token);
  if (!u) return null;
  return { dim: u.dim, display: token };
}

/** The display label for a column's unit — the FC display id's symbol where it maps
 *  cleanly, else the derived-symbol form over the dimension vector ("m/s", "N"). */
export function columnUnitLabel(cu: ColumnUnit): string {
  if (cu.display) {
    const u = fcUnitToUnit(cu.display);
    if (u) return cu.display;
  }
  return formatDim(cu.dim);
}

/** Normalises the AS-TYPED cell to a base-SI `UnitCell` so the unit rides out of the
 *  frame. The display id must be CARRIED: currency collapses to one dimension axis,
 *  so its identity is the id ("$" vs "€"). */
export function tagFrameCellUnit(v: unknown, cu: ColumnUnit): unknown {
  if (typeof v !== "number" || !Number.isFinite(v)) return v;
  const u = cu.display ? fcUnitToUnit(cu.display) : null;
  return u ? fromUnit(v, u, cu.display) : tagDim(v, cu.dim);
}

// A matrix carries ONE whole-grid unit over AS-TYPED cells (unitGranularity) while a list carries
// per-cell base-SI `UnitCell`s, so a rank-changing reshape must CONVERT between the
// two carriers or the unit vanishes.

/** Matrix → list: each as-typed cell becomes a base-SI `UnitCell`; no unit ⇒ unchanged. */
export function taggedListFromMatrix(cells: readonly unknown[], cu: ColumnUnit | undefined): unknown[] {
  return cu ? cells.map((c) => tagFrameCellUnit(c, cu)) : [...cells];
}

/** List → matrix: bare as-typed magnitudes + the ONE unit the list shares (undefined
 *  when the tagged cells disagree) — a matrix is homogeneous (unitGranularity) and never holds
 *  `UnitCell`s. */
export function matrixCellsFromList(cells: readonly unknown[]): { mags: unknown[]; unit: ColumnUnit | undefined } {
  const mags = cells.map((c) => (isUnitCell(c) ? displayMagnitudeOf(c) : c));
  let unit: ColumnUnit | undefined;
  for (const c of cells) {
    if (!isUnitCell(c)) continue;
    const cu: ColumnUnit = { dim: c.dim, display: c.display };
    if (unit === undefined) unit = cu;
    else if (!sameColumnUnit(unit, cu)) return { mags, unit: undefined }; // mixed → strip
  }
  return { mags, unit };
}
