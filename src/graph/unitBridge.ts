// [[C25]] firstClassUnits
import { type Unit, dimEqual, fcUnitToUnit } from "./dimension";
import { UNIT_ANNOTATIONS } from "./formatAnnotationStore";
import { isUnitCell, withMatrixUnit, matrixUnitOf, roundAtLargerTerm, type UnitCell as UnitCellT, type ColumnUnit } from "./unitValue";
import { frameFnOnCore } from "./frameBackend";

/** A value tagged with a Format Controller's unit, on the core (`tag_fc_unit`, the card's own rule): a number takes
 *  the unit, a quantity of its dimension shows in it, a clash or a ratio is `#UNIT!`, and a grid takes the unit as its
 *  own, a held one rescaling. */
export function applyFcUnit(value: unknown, fcUnitId: string, customUnit?: string): unknown {
  const held = Array.isArray(value) ? matrixUnitOf(value) : undefined;
  const r = frameFnOnCore("tagFcUnit", [], [value, fcUnitId, customUnit ?? null, held ? JSON.stringify(held) : null], true);
  if (!r || "frame" in r) return value;
  const [out, table] = r.value as [unknown, string | null];
  if (table === "pass") return value;
  return table ? withMatrixUnit(out, JSON.parse(table) as ColumnUnit) : out;
}

export function displayMagnitudeOf(cell: UnitCellT): number {
  if (cell.display) {
    const u = fcUnitToUnit(cell.display);
    if (u && dimEqual(u.dim, cell.dim)) return roundAtLargerTerm((cell.value - (u.offset ?? 0)) / u.scale, Math.max(Math.abs(cell.value), Math.abs(u.offset ?? 0)) / u.scale);
  }
  return cell.value;
}

export function stripUnitCells(v: unknown): unknown {
  if (isUnitCell(v)) return displayMagnitudeOf(v);
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((c) => {
      const s = stripUnitCells(c);
      if (s !== c) changed = true;
      return s;
    });
    return changed ? out : v;
  }
  return v;
}

/** The FC id whose scale and offset are exactly `u`'s, or none. */
export function exactFcUnitId(u: Unit): string | undefined {
  for (const ann of UNIT_ANNOTATIONS) {
    const cand = fcUnitToUnit(ann.id);
    if (cand && dimEqual(cand.dim, u.dim) && Math.abs(cand.scale - u.scale) <= 1e-9 * Math.abs(u.scale) && (cand.offset ?? 0) === (u.offset ?? 0)) return ann.id;
  }
  return undefined;
}

