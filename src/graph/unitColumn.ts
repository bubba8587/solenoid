// [[D43]] unitByGranularity, [[D47]] noMixCurrencies

import { type ColumnUnit, fromUnit, tagDim, isUnitCell, sameColumnUnit } from "./unitValue";
import { fcUnitToUnit, displayMagnitudeOf } from "./unitBridge";
import { formatDim } from "./dimension";

const CURRENCY_SYMBOL: Record<string, string> = { "$": "usd", "€": "eur", "£": "gbp", "¥": "jpy" };

export function parseColumnUnitFromHeader(header: string): { clean: string; unit?: ColumnUnit } {
  const name = (header ?? "").trim();
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
  if (!m) return { clean: name };
  const clean = m[1].trim();
  const spec = m[2].trim();
  const cu = columnUnitFromSpec(spec);
  return cu ? { clean: clean || name, unit: cu } : { clean: name };
}

export function columnUnitFromSpec(spec: string): ColumnUnit | null {
  const s = spec.trim();
  for (const [sym, id] of Object.entries(CURRENCY_SYMBOL)) {
    if (s.includes(sym)) {
      const u = fcUnitToUnit(id)!;
      return { dim: u.dim, display: id };
    }
  }
  const token = s.replace(/[0#,.\s]/g, "");
  if (token === "") return null;
  const u = fcUnitToUnit(token);
  if (!u) return null;
  return { dim: u.dim, display: token };
}

export function columnUnitLabel(cu: ColumnUnit): string {
  if (cu.display) {
    const u = fcUnitToUnit(cu.display);
    if (u) return cu.display;
  }
  return formatDim(cu.dim);
}

export function tagFrameCellUnit(v: unknown, cu: ColumnUnit): unknown {
  if (typeof v !== "number" || !Number.isFinite(v)) return v;
  const u = cu.display ? fcUnitToUnit(cu.display) : null;
  return u ? fromUnit(v, u, cu.display) : tagDim(v, cu.dim);
}


export function taggedListFromMatrix(cells: readonly unknown[], cu: ColumnUnit | undefined): unknown[] {
  return cu ? cells.map((c) => tagFrameCellUnit(c, cu)) : [...cells];
}

export function matrixCellsFromList(cells: readonly unknown[]): { mags: unknown[]; unit: ColumnUnit | undefined } {
  const mags = cells.map((c) => (isUnitCell(c) ? displayMagnitudeOf(c) : c));
  let unit: ColumnUnit | undefined;
  for (const c of cells) {
    if (!isUnitCell(c)) continue;
    const cu: ColumnUnit = { dim: c.dim, display: c.display };
    if (unit === undefined) unit = cu;
    else if (!sameColumnUnit(unit, cu)) return { mags, unit: undefined };
  }
  return { mags, unit };
}
