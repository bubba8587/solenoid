import { type Unit, type Dim, parseUnit, dimEqual, DIMENSIONLESS, formatDim, customDim } from "./dimension";
import { UNIT_ANNOTATIONS } from "./formatAnnotationStore";
import { fromUnit, isUnitCell, isRatio, withDisplay, unitError, withMatrixUnit, setDisplayScaleResolver, type UnitCell as UnitCellT } from "./unitValue";
import { isSolError } from "./errorValue";

// Units `parseUnit` can't spell; FX is out of scope, so every currency collapses
// onto the single `currency` base axis (no exchange rate).
const DIRECT: Record<string, Unit> = {
  usd: { dim: { currency: 1 }, scale: 1 },
  eur: { dim: { currency: 1 }, scale: 1 },
  gbp: { dim: { currency: 1 }, scale: 1 },
  jpy: { dim: { currency: 1 }, scale: 1 },
  ha: { dim: { length: 2 }, scale: 10000 },
  ac: { dim: { length: 2 }, scale: 4046.8564224 },
  // Volume (US liquid gallon).
  gal: { dim: { length: 3 }, scale: 0.003785411784 },
};

// FC unit id → the string `parseUnit` understands, where they differ. Absent ⇒ the
// id IS the parse string (m, km, kg, s, deg, …).
const PARSE_AS: Record<string, string> = {
  hr: "h",
  ms1: "m/s",
  kmh: "km/h",
  mph: "mi/h",
  b: "byte",
  kb: "kbyte", mb: "Mbyte", gb: "Gbyte", tb: "Tbyte",
  L: "L", mL: "mL", // volume (parser's litre special-case)
};

// Display-unit ids registered by OTHER registries, so a `UnitCell.display` can hold
// ANY id a node authors — a registration seam, so unitBridge never imports nodes/*.
const EXTRA: Record<string, Unit> = {};
export function registerDisplayUnits(units: Record<string, Unit>): void {
  Object.assign(EXTRA, units);
  _cache.clear(); // ids may have been memoized as unresolvable before registration
}

// Resolved FC id → Unit, built once. `none` / `custom` / unresolved ⇒ absent.
const _cache = new Map<string, Unit | null>();

/** The dimensional `Unit` an FC or registered display-unit id denotes, or null
 *  (dimensionless / unknown / `none` / `custom`). */
export function fcUnitToUnit(id: string): Unit | null {
  if (id === "" || id === "none" || id === "custom") return null;
  const hit = _cache.get(id);
  if (hit !== undefined) return hit;
  let u: Unit | null = DIRECT[id] ?? parseUnit(PARSE_AS[id] ?? id) ?? EXTRA[id] ?? null;
  _cache.set(id, u);
  return u;
}

/** The dimension an FC unit id carries (dimensionless if it has none / is unknown). */
export function fcUnitDim(id: string): Dim {
  return fcUnitToUnit(id)?.dim ?? DIMENSIONLESS;
}

/** Is this FC unit id a real DIMENSIONAL unit (participates in the value-layer unit
 *  algebra)? `none`, `custom`, `percent`-style and unresolved ids are not. */
export function isDimensionalFcUnit(id: string): boolean {
  const u = fcUnitToUnit(id);
  return u !== null && !dimEqual(u.dim, DIMENSIONLESS);
}

/** Apply an FC's chosen unit to a value — the FC is VALUE-MUTATING: the unit
 *  becomes a property of the VALUE (a base-SI `UnitCell` + display id). */
export function applyFcUnit(value: unknown, fcUnitId: string, customUnit?: string): unknown {
  // A custom free-text unit carries no display id — formatDim renders the name.
  const custom = fcUnitId === "custom" && customUnit && customUnit.trim() !== "";
  const u: Unit | null = custom ? { dim: customDim(customUnit!.trim()), scale: 1 } : fcUnitToUnit(fcUnitId);
  const displayId = custom ? undefined : fcUnitId;
  if (!u) return value; // none / empty custom / unresolved — carry any existing tag through
  const one = (v: unknown): unknown => {
    if (v === null || isSolError(v)) return v;
    if (isRatio(v)) {
      // A pure ratio is KNOWN-dimensionless — re-labeling it is a category error.
      return unitError("This is a pure ratio (its units canceled) — it can't be re-labeled with a unit. Multiply by a base quantity instead.");
    }
    if (isUnitCell(v)) {
      if (!dimEqual(v.dim, u.dim)) {
        return unitError(
          `This value is ${formatDim(v.dim) || "a plain number"}, but the format unit is ${formatDim(u.dim) || "dimensionless"}. Convert it first.`,
        );
      }
      return displayId ? withDisplay(v, displayId) : v; // custom: keep the cell, no display id
    }
    return typeof v === "number" ? fromUnit(v, u, displayId) : v;
  };
  if (Array.isArray(value)) {
    if (value.some((c) => Array.isArray(c))) {
      // A homogeneous NUMERIC matrix carries ONE unit for the whole grid (D20).
      const firstRow = (value as unknown[]).find((r) => Array.isArray(r)) as unknown[] | undefined;
      const firstCell = firstRow?.find((c) => c !== null && c !== undefined && c !== "");
      // Tag a COPY of the outer array, never `value` itself — the DataflowEngine hands
      // the identical cached reference to every downstream consumer.
      return typeof firstCell === "number"
        ? withMatrixUnit((value as unknown[]).slice() as typeof value, { dim: u.dim, display: displayId })
        : value;
    }
    return value.map(one);
  }
  return one(value);
}

/** The magnitude of a dimensioned cell in its own DISPLAY unit ("5 km" ⇒ 5, not
 *  the base-SI 5000); no display id ⇒ its base magnitude. */
export function displayMagnitudeOf(cell: UnitCellT): number {
  if (cell.display) {
    const u = fcUnitToUnit(cell.display);
    if (u && dimEqual(u.dim, cell.dim)) return (cell.value - (u.offset ?? 0)) / u.scale;
  }
  return cell.value;
}

/** Unwrap every `UnitCell` to its display magnitude — the UNIT-BLIND BOUNDARY, so
 *  every node that isn't unit-aware sees plain numbers; returns the SAME reference
 *  when nothing is dimensioned. */
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

/** An FC unit id matching a `Unit` — exact scale preferred, else the first id of
 *  the same dimension; absent ⇒ no FC id fits (show the derived symbol). */
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

// Upgrade unitValue's adoption resolver to the FULL FC unit table (its default
// knows only the dimension.ts spellings); unitBridge is on every compute path.
setDisplayScaleResolver((id) => fcUnitToUnit(id)?.scale ?? null);
