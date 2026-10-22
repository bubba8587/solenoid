// [[D100]] computedColumnInfersUnit, [[C25]] firstClassUnits
import { parseFormula, type Ast } from "./excelFormula";
import type { RowColumn, RowTable } from "./computedColumnCore";
import { isSolError, type SolError } from "./errorValue";
import { isUnitCell, isAffineDisplay, unitError, type ColumnUnit } from "./unitValue";
import { fcUnitToUnit, displayMagnitudeOf, exactFcUnitId } from "./unitBridge";
import { columnUnitLabel } from "./unitColumn";
import { dimEvalWithCode, affineWeight, type DimEnv, type CodeEnv, type Lam } from "./unitDimExpr";
import { type Dim, type Unit, DIMENSIONLESS, isDimensionless, dimEqual, dimMul, dimPow, convert, formatDim } from "./dimension";
import { isLambdaValue, type LambdaValue } from "./lambdaValue";

/** A column's definition as the unit pass reads it: the formula, and the LAMBDAs it calls by name. */
export interface ColumnDefinition { ast: Ast; fns: ReadonlyMap<string, Lam> }

const lamOf = (v: unknown): Lam | null => {
  const body = isLambdaValue(v) && v.expr ? parseFormula(v.expr) : null;
  return body ? { params: (v as LambdaValue).params, body } : null;
};

export function exprDefinition(expr: string, lams: ReadonlyMap<string, unknown> = new Map()): ColumnDefinition | null {
  const ast = parseFormula(expr);
  if (!ast) return null;
  const fns = new Map<string, Lam>();
  for (const [name, v] of lams) { const l = lamOf(v); if (l) fns.set(name, l); }
  return { ast, fns };
}

/** A bare λ column reads its parameters' columns row by row. */
export function lambdaDefinition(lam: LambdaValue): ColumnDefinition | null {
  const l = lamOf(lam);
  if (!l) return null;
  return { ast: { t: "call", name: "λ", args: lam.params.map((name): Ast => ({ t: "atcol", name })) }, fns: new Map([["λ", l]]) };
}

export interface ColumnUnitPlan<C> {
  /** The table in the magnitudes the formula runs on. */
  table: RowTable;
  /** A wired side value in those same magnitudes. */
  side: (v: unknown) => unknown;
  /** The computed cells in the result column's unit, and that unit. */
  finish: (cells: C[]) => { cells: C[]; unit?: ColumnUnit };
}

type United = { dim: Dim; display?: string; list: boolean };

function shownOf(v: unknown): unknown {
  if (isUnitCell(v)) return displayMagnitudeOf(v);
  if (Array.isArray(v)) return v.map(shownOf);
  return v;
}

function baseOf(v: unknown): unknown {
  if (isUnitCell(v)) return v.value;
  if (Array.isArray(v)) return v.map(baseOf);
  return v;
}

/** A side value's one dimension and shared display, or the #UNIT! for a list mixing two. */
function sideUnit(name: string, v: unknown): United | SolError | null {
  const cells = Array.isArray(v) ? v.flat(2) : [v];
  let dim: Dim | null = null;
  let display: string | undefined;
  let mixedDisplay = false;
  for (const c of cells) {
    if (!isUnitCell(c) || isDimensionless(c.dim)) continue;
    if (dim === null) { dim = c.dim; display = c.display; continue; }
    if (!dimEqual(dim, c.dim)) return unitError(`${name} holds mixed units: ${formatDim(dim)} and ${formatDim(c.dim)}.`);
    if (c.display !== display) mixedDisplay = true;
  }
  return dim === null ? null : { dim, display: mixedDisplay ? undefined : display, list: Array.isArray(v) };
}

function referencedNames(def: ColumnDefinition): string[] {
  const out = new Set<string>();
  const walk = (n: Ast): void => {
    if (n.t === "name" || n.t === "atcol" || n.t === "wholecol") { if (!def.fns.has(n.name)) out.add(n.name); }
    else if (n.t === "call") n.args.forEach(walk);
    else if (n.t === "apply") { walk(n.fn); n.args.forEach(walk); }
    else if (n.t === "unary" || n.t === "percent") walk(n.arg);
    else if (n.t === "bin") { walk(n.l); walk(n.r); }
  };
  walk(def.ast);
  for (const l of def.fns.values()) walk(l.body);
  return [...out];
}

const linearUnit = (id: string | undefined, dim: Dim): Unit | null => {
  const u = id ? fcUnitToUnit(id) : null;
  return u && !u.offset && dimEqual(u.dim, dim) ? u : null;
};

const scaleCells = <C>(cells: C[], k: number): C[] =>
  k === 1 ? cells : cells.map((c) => (typeof c === "number" ? (c * k) as C : c));

/**
 * The unit pass of one computed column, run once per column: the formula's dimension from its
 * input columns' units and its side values' units, as Expression works it out. When every united
 * input reads in a linear display unit the formula runs on the displayed numbers and the answer
 * keeps their composed display (km / h is km/h); otherwise it runs in base SI. An authored unit
 * wins, and a dimension clash with it is #UNIT!.
 */
export function planColumnUnits<C>(
  def: ColumnDefinition | null,
  table: { columns: ReadonlyArray<RowColumn & { unit?: ColumnUnit }> },
  opts: { alias?: Record<string, string | undefined>; sideValue?: (name: string) => unknown; authored?: ColumnUnit | null } = {},
): ColumnUnitPlan<C> | SolError {
  const authored = opts.authored && !isDimensionless(opts.authored.dim) ? opts.authored : null;
  const tagAuthored = (cells: C[]) => ({ cells, ...(authored ? { unit: authored } : {}) });
  const plain: ColumnUnitPlan<C> = { table, side: shownOf, finish: tagAuthored };
  if (!def) return plain;

  const byName = new Map(table.columns.map((c) => [c.name, c] as const));
  const united = new Map<string, United>();
  const bare = new Set<string>();
  for (const n of referencedNames(def)) {
    const col = byName.get(opts.alias?.[n] ?? n);
    let u: United | SolError | null = null;
    if (col) u = col.unit && !isDimensionless(col.unit.dim) ? { dim: col.unit.dim, display: col.unit.display, list: true } : null;
    else if (opts.sideValue) u = sideUnit(n, opts.sideValue(n));
    if (isSolError(u)) return u;
    if (u) united.set(n, u); else bare.add(n);
  }
  if (united.size === 0) return plain;

  const env: DimEnv = {};
  const codes: CodeEnv = {};
  for (const [n, u] of united) {
    env[n] = u.dim;
    if (u.display && dimEqual(u.dim, { currency: 1 })) codes[n] = u.display;
  }
  const r = dimEvalWithCode(def.ast, env, codes, def.fns);
  if (isSolError(r)) return r;
  // Indeterminate: the unit drops and the cells are the numbers the columns show, never base SI with no unit.
  if (r === null) return plain;
  const dr = r === null || isDimensionless(r.dim) ? null : r.dim;

  if (authored && dr && !dimEqual(dr, authored.dim)) {
    return unitError(`The formula gives ${formatDim(dr)}, but the column's unit is ${columnUnitLabel(authored)}.`);
  }
  if (authored && r?.code && authored.display && dimEqual(authored.dim, { currency: 1 }) && authored.display !== r.code) {
    return unitError(`The formula gives ${r.code}, but the column's unit is ${authored.display}: they are different currencies with no exchange rate.`);
  }

  // An offset scale (°C) is classified as Expression classifies it: a reading, a difference, or #UNIT!.
  const inputs = [...united.values()];
  const ids = new Set(inputs.map((u) => u.display));
  const sharedId = ids.size === 1 ? inputs[0].display : undefined;
  const shared = sharedId ? fcUnitToUnit(sharedId) : null;
  const sharedAffine = shared && shared.offset && inputs.every((u) => dimEqual(u.dim, shared.dim)) ? shared : null;
  let point: 0 | 1 | null = null;
  if (sharedAffine || inputs.every((u) => isAffineDisplay(u.display))) {
    const names = new Set(united.keys());
    const lists = new Set([...united].filter(([, u]) => u.list).map(([n]) => n));
    const w = affineWeight(def.ast, names, lists, def.fns, bare);
    if (isSolError(w)) return w;
    point = w;
  }

  // The result's unit before an authored one takes over: `unit` names the display the cells are in.
  let result: { scale: number; unit?: ColumnUnit } | null = null;
  let shown = false;
  if (sharedAffine) {
    shown = true;
    result = !dr ? { scale: 1 }
      : point === 1 ? { scale: 1, unit: { dim: dr, display: sharedId } }
      : { scale: sharedAffine.scale, unit: { dim: dr } };
  } else if (inputs.every((u) => linearUnit(u.display, u.dim))) {
    // Each display unit is its own axis, so the pass says which display units the answer is in.
    const dispEnv: DimEnv = {};
    for (const [n, u] of united) dispEnv[n] = { [`⟨${u.display}⟩`]: 1 };
    const rd = dimEvalWithCode(def.ast, dispEnv, {}, def.fns);
    if (rd && !isSolError(rd)) {
      shown = true;
      let scale = 1;
      let dim: Dim = DIMENSIONLESS;
      const axes = Object.entries(rd.dim).filter(([, e]) => e !== 0);
      for (const [axis, e] of axes) {
        const u = fcUnitToUnit(axis.slice(1, -1))!;
        scale *= u.scale ** e;
        dim = dimMul(dim, dimPow(u.dim, e));
      }
      const id = !dr ? undefined
        : axes.length === 1 && axes[0][1] === 1 ? axes[0][0].slice(1, -1)
        : exactFcUnitId({ dim, scale });
      result = !dr ? { scale }
        : id ? { scale: 1, unit: { dim: dr, display: id } }
        : { scale, unit: { dim: dr } };
    }
  }
  if (!result) result = dr ? { scale: 1, unit: { dim: dr, ...(r?.code ? { display: r.code } : {}) } } : { scale: 1 };

  const columns = shown ? table.columns : table.columns.map((c) => {
    const u = c.unit && !isDimensionless(c.unit.dim) && c.unit.display ? fcUnitToUnit(c.unit.display) : null;
    if (!u || (u.scale === 1 && !u.offset)) return c;
    return { ...c, values: c.values.map((v) => (typeof v === "number" ? v * u.scale + (u.offset ?? 0) : v)) };
  });
  const res = result;
  return {
    table: { columns },
    side: shown ? shownOf : baseOf,
    finish: (cells) => {
      const scaled = scaleCells(cells, res.scale);
      if (!authored) return { cells: scaled, ...(res.unit ? { unit: res.unit } : {}) };
      if (!res.unit) return { cells: scaled, unit: authored };
      const from: Unit = (res.unit.display && fcUnitToUnit(res.unit.display)) || { dim: res.unit.dim, scale: 1 };
      const to: Unit = (authored.display && fcUnitToUnit(authored.display)) || { dim: authored.dim, scale: 1 };
      const out = scaled.map((c) => (typeof c === "number" ? (convert(c, from, to) ?? c) as C : c));
      return { cells: out, unit: authored };
    },
  };
}
