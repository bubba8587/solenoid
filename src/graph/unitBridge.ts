// ─── Unit bridge — FC unit ids ⇄ dimensional Units (Bundle 05: FC A4) ────────────
// The Format Controller layer names units by an ID string ("m", "km", "usd", "mph")
// from UNIT_ANNOTATIONS (formatAnnotationStore.ts). The value layer computes with
// dimensional `Unit`s (exponent vector + SI scale) from dimension.ts. This module
// is the one-way lookup between them, so a source that carries an FC unit id can
// mint a base-SI `UnitCell`, and a `UnitCell`'s dimension can be shown with the
// user's chosen display id.
//
// Pure — imports the dimension algebra + the FC unit list only, no React/Rete.

import { type Unit, type Dim, parseUnit, dimEqual, DIMENSIONLESS, formatDim, customDim } from "./dimension";
import { UNIT_ANNOTATIONS } from "./formatAnnotationStore";
import { fromUnit, isUnitCell, isRatio, withDisplay, unitError, withMatrixUnit, setDisplayScaleResolver, type UnitCell as UnitCellT } from "./unitValue";
import { isSolError } from "./errorValue";

// Units the dimension.ts parser can't spell (compound / non-metric areas & volumes,
// and the shared currency axis — FX is out of scope, so every currency is ONE
// dimension). Everything else resolves through `parseUnit`.
const DIRECT: Record<string, Unit> = {
  // Currencies collapse onto the single `currency` base axis (no exchange rate).
  usd: { dim: { currency: 1 }, scale: 1 },
  eur: { dim: { currency: 1 }, scale: 1 },
  gbp: { dim: { currency: 1 }, scale: 1 },
  jpy: { dim: { currency: 1 }, scale: 1 },
  // Areas the parser doesn't know.
  ha: { dim: { length: 2 }, scale: 10000 },
  ac: { dim: { length: 2 }, scale: 4046.8564224 },
  // Volume (US liquid gallon).
  gal: { dim: { length: 3 }, scale: 0.003785411784 },
};

// FC unit id → the string `parseUnit` understands, where they differ. Absent ⇒ the
// id IS the parse string (m, km, kg, s, deg, …).
const PARSE_AS: Record<string, string> = {
  hr: "h",          // FC "hr" = hour
  ms1: "m/s",       // speed
  kmh: "km/h",
  mph: "mi/h",
  b: "byte",        // data
  kb: "kbyte", mb: "Mbyte", gb: "Gbyte", tb: "Tbyte",
  L: "L", mL: "mL", // volume (parser's litre special-case)
};

// Display-unit ids registered by OTHER registries (the Convert node's
// CONVERT_UNIT_DEFS — yd, psi, km_h, …), so a `UnitCell.display` can hold ANY id a
// node can author, and the display layer resolves it here. Convert registers at
// module load (registration seam — no import cycle: unitBridge never imports nodes/*).
const EXTRA: Record<string, Unit> = {};
export function registerDisplayUnits(units: Record<string, Unit>): void {
  Object.assign(EXTRA, units);
  _cache.clear(); // ids may have been memoized as unresolvable before registration
}

// Resolved FC id → Unit, built once. `none` / `custom` / unresolved ⇒ absent.
const _cache = new Map<string, Unit | null>();

/** The dimensional `Unit` a display-unit id denotes — an FC unit id or any
 *  registered id (Convert's registry) — or null (dimensionless / unknown /
 *  `none` / `custom`). Memoized. */
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

/**
 * Apply a Format Controller's chosen unit to a value — the FC is VALUE-MUTATING
 * (FC A4): the unit becomes a property of the VALUE (a base-SI `UnitCell` +
 * display id), not a display-only annotation, so it computes downstream and a
 * dimension clash surfaces as a real `#UNIT!`. Handles a scalar or a 1-D list
 * (per cell); a 2-D matrix is unit-agnostic (author decision) and passes through,
 * as do frames / lambdas / strings / objects.
 *
 *   • a dimensionless number + a real unit → tag it base SI, interpreting the
 *     magnitude AS that unit (`5` + km ⇒ 5000 m, display "km") — same reading as
 *     the Number node's unit picker;
 *   • an already-dimensioned cell + a COMMENSURABLE unit → keep the base value,
 *     just RE-DISPLAY in the new unit (km → mi is a display change, base is
 *     dimension-invariant);
 *   • dimensioned + an INCOMMENSURABLE unit → `#UNIT!` (a true dimension clash —
 *     a length can't be re-labeled a mass);
 *   • unit `custom` with a free-text name → an OPAQUE custom dimension (`poop` is its
 *     own axis: `poop ÷ s` = `poop/s`, not Hz). The name renders via `formatDim`, so
 *     the cell carries no `display` id (there's no registry unit to resolve).
 *   • unit `none` / empty / unresolved → unchanged (any existing tag rides on).
 */
export function applyFcUnit(value: unknown, fcUnitId: string, customUnit?: string): unknown {
  // A custom free-text unit tags an opaque custom dimension; no display id (formatDim
  // renders the name). A blank custom name is a no-op.
  const custom = fcUnitId === "custom" && customUnit && customUnit.trim() !== "";
  const u: Unit | null = custom ? { dim: customDim(customUnit!.trim()), scale: 1 } : fcUnitToUnit(fcUnitId);
  const displayId = custom ? undefined : fcUnitId;
  if (!u) return value; // none / empty custom / unresolved — carry any existing tag through
  const one = (v: unknown): unknown => {
    if (v === null || isSolError(v)) return v;
    if (isRatio(v)) {
      // A pure ratio is KNOWN-dimensionless (units canceled) — re-labeling it with
      // a physical unit is a category error. Number formats (percent) still apply.
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
      // A homogeneous NUMERIC matrix carries ONE unit for the whole grid (D20). The
      // cells stay bare numbers; the unit tags the outer array. A non-numeric matrix
      // (text/logical) can't take a physical unit — pass it through unchanged.
      const firstRow = (value as unknown[]).find((r) => Array.isArray(r)) as unknown[] | undefined;
      const firstCell = firstRow?.find((c) => c !== null && c !== undefined && c !== "");
      // Tag a COPY of the outer array, never `value` itself. rete-engine's
      // DataflowEngine caches a node's output and hands the identical reference to
      // every downstream consumer (no cloning), so mutating `value` in place would
      // stamp the unit onto the UPSTREAM node's cached matrix — a second consumer
      // (or a plain Display) would then see a unit it never authored, and two FCs on
      // one source would race last-write-wins. The rows/cells stay shared (immutable
      // numbers); only the outer array must be fresh so the symbol tag is private.
      return typeof firstCell === "number"
        ? withMatrixUnit((value as unknown[]).slice() as typeof value, { dim: u.dim, display: displayId })
        : value;
    }
    return value.map(one);
  }
  return one(value);
}

/** The magnitude of a dimensioned cell in its own DISPLAY unit — the number the
 *  user typed/expects ("5 km" ⇒ 5, not the base-SI 5000). A cell with no display
 *  id (an algebra result) reads as its base magnitude. */
export function displayMagnitudeOf(cell: UnitCellT): number {
  if (cell.display) {
    const u = fcUnitToUnit(cell.display);
    if (u && dimEqual(u.dim, cell.dim)) return (cell.value - (u.offset ?? 0)) / u.scale;
  }
  return cell.value;
}

/**
 * Unwrap every `UnitCell` in a value to its display magnitude — the UNIT-BLIND
 * BOUNDARY (FC A4): the dimension algebra runs only in unit-aware nodes
 * (`unitAware = true` / the passthrough markers — see coerceInputs); every OTHER
 * node receives plain numbers, in the unit the user sees, exactly as before units
 * existed. Without this, a `UnitCell` object reaches `coerceNumber` as NaN and a
 * comparison/threshold/chart silently breaks (the 2026-07-13 regression).
 * Returns the SAME reference when nothing is dimensioned (the common case).
 */
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

/** Find an FC unit id whose dimension + scale match a `Unit` (for showing a derived
 *  value in a friendly id). Prefers an exact scale match; falls back to the first
 *  id of the same dimension. Absent ⇒ no FC id fits (show the derived symbol). */
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

// Upgrade unitValue's bare-number adoption resolver to the FULL FC unit table
// (miles, gallons, currencies, the DIRECT/EXTRA sets) — its default only knows
// the pure dimension.ts spellings. Module-load side effect; unitBridge is on
// every compute path (coerceInputs), so the app always has the full table.
setDisplayScaleResolver((id) => fcUnitToUnit(id)?.scale ?? null);
