// [[C25]], [[D43]]
import { type Unit, type Dim, parseUnit, dimEqual, DIMENSIONLESS, formatDim, customDim } from "./dimension";
import { UNIT_ANNOTATIONS, isFcUnit, unitById } from "./formatAnnotationStore";
import { fromUnit, formatUnitCell, isUnitCell, isRatio, withDisplay, unitError, withMatrixUnit, matrixUnitOf, setDisplayScaleResolver, setDisplayOffsetResolver, type UnitCell as UnitCellT, type ColumnUnit } from "./unitValue";
import { isSolError } from "./errorValue";

const DIRECT: Record<string, Unit> = {
  usd: { dim: { currency: 1 }, scale: 1 },
  eur: { dim: { currency: 1 }, scale: 1 },
  gbp: { dim: { currency: 1 }, scale: 1 },
  jpy: { dim: { currency: 1 }, scale: 1 },
  ha: { dim: { length: 2 }, scale: 10000 },
  ac: { dim: { length: 2 }, scale: 4046.8564224 },
  gal: { dim: { length: 3 }, scale: 0.003785411784 },
};

const PARSE_AS: Record<string, string> = {
  hr: "h",
  ms1: "m/s",
  kmh: "km/h",
  mph: "mi/h",
  b: "byte",
  kb: "kbyte", mb: "Mbyte", gb: "Gbyte", tb: "Tbyte",
  L: "L", mL: "mL",
};

const EXTRA: Record<string, Unit> = {};
export function registerDisplayUnits(units: Record<string, Unit>): void {
  Object.assign(EXTRA, units);
  _cache.clear(); // ids may already be memoized as unresolvable
}

const _cache = new Map<string, Unit | null>();

export function fcUnitToUnit(id: string): Unit | null {
  if (id === "" || id === "none" || id === "custom") return null;
  const hit = _cache.get(id);
  if (hit !== undefined) return hit;
  let u: Unit | null = DIRECT[id] ?? parseUnit(PARSE_AS[id] ?? id) ?? EXTRA[id] ?? null;
  _cache.set(id, u);
  return u;
}

export function fcUnitDim(id: string): Dim {
  return fcUnitToUnit(id)?.dim ?? DIMENSIONLESS;
}

export function isDimensionalFcUnit(id: string): boolean {
  const u = fcUnitToUnit(id);
  return u !== null && !dimEqual(u.dim, DIMENSIONLESS);
}

export function applyFcUnit(value: unknown, fcUnitId: string, customUnit?: string): unknown {
  const custom = fcUnitId === "custom" && customUnit && customUnit.trim() !== "";
  const u: Unit | null = custom ? { dim: customDim(customUnit.trim()), scale: 1 } : fcUnitToUnit(fcUnitId);
  const displayId = custom ? undefined : fcUnitId;
  if (!u) return value;
  const one = (v: unknown): unknown => {
    if (v === null || isSolError(v)) return v;
    if (isRatio(v)) {
      return unitError("This is a pure ratio (its units canceled) — it can't be re-labeled with a unit. Multiply by a base quantity instead.");
    }
    if (isUnitCell(v)) {
      if (!dimEqual(v.dim, u.dim)) {
        return unitError(
          `This value is ${formatDim(v.dim) || "a plain number"}, but the format unit is ${formatDim(u.dim) || "dimensionless"}. Convert it first.`,
        );
      }
      return displayId ? withDisplay(v, displayId) : v;
    }
    return typeof v === "number" ? fromUnit(v, u, displayId) : v;
  };
  if (Array.isArray(value)) {
    if (value.some((c) => Array.isArray(c))) {
      const firstRow = (value as unknown[]).find((r) => Array.isArray(r)) as unknown[] | undefined;
      const firstCell = firstRow?.find((c) => c !== null && c !== undefined && c !== "");
      if (typeof firstCell !== "number") return value;
      const held = matrixUnitOf(value);
      if (held) return redisplayMatrix(value as unknown[][], held, u, displayId);
      // Tag a copy: the engine hands this same cached array to every consumer.
      return withMatrixUnit((value as unknown[]).slice() as typeof value, { dim: u.dim, display: displayId });
    }
    return value.map(one);
  }
  return one(value);
}

/** A matrix that already carries a unit keeps its value: a clash is `#UNIT!`, and a
 *  commensurable new display unit rescales the as-typed cells. */
function redisplayMatrix(m: unknown[][], held: ColumnUnit, u: Unit, displayId: string | undefined): unknown {
  if (!dimEqual(held.dim, u.dim)) {
    return unitError(
      `This grid is ${formatDim(held.dim)}, but the format unit is ${formatDim(u.dim) || "dimensionless"}. Convert it first.`,
    );
  }
  if (!displayId || (held.display ?? "") === displayId) return m;
  const from = held.display ? fcUnitToUnit(held.display) : null;
  const fromScale = from?.scale ?? 1, fromOff = from?.offset ?? 0, toOff = u.offset ?? 0;
  const rescale = (c: unknown) => (typeof c === "number" ? (c * fromScale + fromOff - toOff) / u.scale : c);
  const out = m.map((r) => (Array.isArray(r) ? r.map(rescale) : rescale(r)));
  return withMatrixUnit(out, { dim: u.dim, display: displayId });
}

export function displayMagnitudeOf(cell: UnitCellT): number {
  if (cell.display) {
    const u = fcUnitToUnit(cell.display);
    if (u && dimEqual(u.dim, cell.dim)) return (cell.value - (u.offset ?? 0)) / u.scale;
  }
  return cell.value;
}

/** A cell as text in the unit it reads in ("5 km", "$5"); without a named display unit, its base
 *  magnitude and derived symbol. */
export function unitCellText(cell: UnitCellT, fmtNum: (n: number) => string): string {
  const u = cell.display && isFcUnit(cell.display) ? fcUnitToUnit(cell.display) : null;
  if (!u || !dimEqual(u.dim, cell.dim)) return formatUnitCell(cell, fmtNum);
  const { label, prefix } = unitById(cell.display!);
  const mag = fmtNum(displayMagnitudeOf(cell));
  return prefix ? `${label}${mag}` : `${mag}${label}`;
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

export function fcUnitIdForUnit(u: Unit): string | undefined {
  let sameDim: string | undefined;
  for (const ann of UNIT_ANNOTATIONS) {
    const cand = fcUnitToUnit(ann.id);
    if (!cand || !dimEqual(cand.dim, u.dim)) continue;
    if (Math.abs(cand.scale - u.scale) < 1e-12 && (cand.offset ?? 0) === (u.offset ?? 0)) return ann.id;
    if (sameDim === undefined) sameDim = ann.id;
  }
  return sameDim;
}

setDisplayScaleResolver((id) => fcUnitToUnit(id)?.scale ?? null);
setDisplayOffsetResolver((id) => fcUnitToUnit(id)?.offset ?? null);

/** A formula preset's input read in its declared unit ([[C25]] firstClassUnits): a bare number is
 *  taken as already in it, a dimensioned cell converts, and another dimension is #UNIT!. */
export function readInDeclaredUnit(v: unknown, unitId: string): unknown {
  const u = fcUnitToUnit(unitId);
  if (!u) return v;
  const label = UNIT_ANNOTATIONS.find((a) => a.id === unitId)?.label.trim() ?? unitId;
  const one = (c: unknown): unknown => {
    if (!isUnitCell(c) || dimEqual(c.dim, DIMENSIONLESS)) return isUnitCell(c) ? c.value : c;
    if (!dimEqual(c.dim, u.dim)) return unitError(`This input reads in ${label}; convert it first.`);
    return (c.value - (u.offset ?? 0)) / u.scale;
  };
  if (!Array.isArray(v)) return one(v);
  const out = v.map((c) => (Array.isArray(c) ? c.map(one) : one(c)));
  const err = out.flat().find(isSolError);
  return err ?? out;
}
