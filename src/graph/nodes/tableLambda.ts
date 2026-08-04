import { ClassicPreset } from "rete";
import { numIn, anyIn, anyTableIn, lambdaIn, resultOut, readInput, type ResultType } from "./shared";
import { toAnyMatrix } from "./coerce";
import { compilePositional, parseFormula, formulaSyntaxHint, extractVariables } from "../excelFormula";
import { isLambdaValue, type LambdaValue } from "./lambda";
import { solError, isSolError, type SolError, type SolErrorCode } from "../errorValue";
import { isUnitCell, tagDim, magnitudeOf, unitError, type UnitCell } from "../unitValue";
import { dimEval, type DimEnv } from "../unitDimExpr";
import { type Dim, dimEqual, isDimensionless } from "../dimension";

// ─── 2D LAMBDA family: MAP / BYROW / BYCOL / MAKEARRAY / REDUCE ─────────────────
// Excel's MAP/BYROW/BYCOL/MAKEARRAY/REDUCE take a LAMBDA. Each node holds its
// formula as a string, typed inline in the node's "Formula" field (or the big
// FormulaPopup editor); a wired LAMBDA value supersedes it. Those two authoring
// paths (inline field/popup + the lambda socket) are the only ones — reuse-across-
// nodes is the LAMBDA node's job.
// Fixed variables — word names, and the fold pair uses stepped language (they run
// in sequence) while MAP/MAKEARRAY are parallel-per-cell (positional, no stepping):
//   MAP        → `value` (cell; `value2`,`value3` from optional 2nd/3rd tables),
//                plus `row`,`col` (1-based position)
//   BYROW/BYCOL→ `values` (the row/column as a list — reduce it with SUM/MAX/…)
//   MAKEARRAY  → `row`,`col` (1-based indices)
//   REDUCE/SCAN→ `acc` (running accumulator), `value` (element at this step),
//                `step` (1-based position in the sequence)
// Compiled by the shared excelFormula engine; Excel aggregates (SUM, AVERAGE, …)
// resolve through Formula.js and accept the vector `v`.
//
// VALUE-POLYMORPHIC (polyform): the formula can return text or a date serial,
// not just a number — `MAP(names, UPPER(x))`, `TEXTJOIN(" ", first, last)`,
// `MAP(dates, EDATE(x, 1))`. A result-type selector swaps the output socket to
// the matching type AT THE NODE'S DIMENSIONALITY (MAP/MAKEARRAY → matrix:
// table/strtable/datetable; BYROW/BYCOL → combo; REDUCE → scalar). The mapped
// value inputs are `any` so arrays of any element type connect. See
// nodes/shared.ts (ResultType) and excelFormula.ts (compilePositional).

type Cell = number | string | boolean | null | SolError; // a mapped value — number (date serial), text, logical, null (missing), or a per-cell error
type Mat = Cell[][];
type LambdaFn = (...args: unknown[]) => unknown;

/** Compile a lambda body (Excel syntax) over fixed `varNames`, through the shared
 *  array-aware evaluator. Hosts call it positionally (MAP `fn(x,y,z,r,c)` per cell,
 *  BYROW `fn(vec)` per vector, REDUCE `fn(acc,x,i)` folding, MAKEARRAY `fn(r,c)`);
 *  the evaluator decides broadcast-vs-aggregate per call site, so a BYROW vector
 *  flows whole into `SUM(values)`. */
export function compileLambda(expr: string, varNames: string[]): LambdaFn | null {
  return compilePositional(expr, varNames) as LambdaFn | null;
}

/**
 * Resolve the function a lambda-family node runs. A wired LAMBDA value wins;
 * otherwise the inline formula text compiles over the node's fixed variable
 * names. Binding of a wired lambda's params: by POSITION by default (`provided`
 * = how many positional values the node passes; a lambda declaring more can't be
 * satisfied), or — with `byName` (SCAN/REDUCE, D18) — matched to `varNames` by
 * NAME (order-free; a param outside `varNames` is an error, see the branch).
 */
// `err` is the short message shown inline in the node (FormulaError); `code` tags
// the same failure for the propagating SolError so downstream nodes show the red
// badge. An arity mismatch is a #VALUE! (wrong operand), a bad formula a #SYNTAX!.
function resolveFn(
  lam: unknown, inline: string | undefined,
  fallback: string, varNames: string[], provided: number,
  byName = false,
): { fn: LambdaFn | null; err: string | null; code: SolErrorCode } {
  if (isLambdaValue(lam)) {
    if (byName) {
      // Bind the lambda's declared params to THIS node's variables BY NAME, not by
      // position — a param named `acc` always receives the accumulator, whatever
      // order it was declared in, so the param names can't silently lie. A param
      // that isn't one of the node's variables can't be supplied → error (captured
      // constants aren't params; they stay baked in the closure and pass through).
      // See decisions.md D18.
      const unknown = lam.params.filter((p) => !varNames.includes(p));
      if (unknown.length) {
        return { fn: null, err: `Lambda param ${unknown.join(", ")} isn't one of this node's variables (${varNames.join(", ")})`, code: "#VALUE!" };
      }
      const base = lam.fn as LambdaFn;
      const order = lam.params.map((p) => varNames.indexOf(p));
      const byNameFn: LambdaFn = (...nodeArgs) => base(...order.map((i) => nodeArgs[i]));
      return { fn: byNameFn, err: null, code: "#VALUE!" };
    }
    if (lam.params.length > provided) {
      return { fn: null, err: `Lambda takes ${lam.params.length} values; this node passes ${provided}`, code: "#VALUE!" };
    }
    return { fn: lam.fn as LambdaFn, err: null, code: "#VALUE!" };
  }
  const src = inline && inline.trim() ? inline : fallback;
  const fn = compileLambda(src, varNames);
  if (!fn) return { fn: null, err: formulaSyntaxHint(src) ?? "Syntax error", code: "#SYNTAX!" };
  // The inline formula sees ONLY this node's fixed variables — an outside name
  // evaluates against undefined and produces garbage deep inside a function.
  // Catch it here with the actual escape hatch spelled out (the LAMBDA node's
  // extra names become capture inputs; wire its output into the Lambda socket).
  const unknown = extractVariables(src).filter((v) => !varNames.includes(v));
  if (unknown.length) {
    return {
      fn: null,
      err: `Unknown name ${unknown.join(", ")} — this formula sees only (${varNames.join(", ")}). To use an outside value, put the formula in a LAMBDA node (extra names become inputs) and wire it into the Lambda socket`,
      code: "#NAME?",
    };
  }
  return { fn, err: null, code: "#SYNTAX!" };
}

/** The error a lambda-family node returns when its formula won't resolve: keeps
 *  the inline `cachedError` hint (set by the caller) and ALSO propagates a tagged
 *  value so downstream nodes show the chain. `cachedResult` stays null — the
 *  node's own box shows the richer inline message, not a bare badge. */
function fnError(err: string, code: SolErrorCode): { result: SolError } {
  return { result: solError(code, err) };
}

function transpose<T>(m: T[][]): T[][] {
  const cols = m[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, j) => m.map((row) => row[j]));
}

/** Guard one mapped result: a per-cell error PROPAGATES (`#DIV/0!` from `1/0`, …);
 *  text, a BOOLEAN and a finite number (a date serial is one) pass through;
 *  anything else (non-finite, undefined, a wired-in null) → `null`, the MISSING
 *  sentinel (skipped by aggregators). */
function cell(v: unknown): Cell {
  if (isSolError(v)) return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ─── Unit carry over a 1-D list (FC A4) ────────────────────────────────────────
// REDUCE / BYROW / BYCOL carry dimensional units the same way the Expression node
// does: strip the tagged cells to base-SI magnitudes for the numeric fold, then
// interpret the formula with `dimEval` (the fold/aggregate variables bound to the
// input's element dimension) to determine the result's dimension, and re-tag it.
// A dimension clash inside the formula surfaces as #UNIT!. MAP / MAKEARRAY / SCAN
// are matrix producers — unit-agnostic by design — so they don't take this path,
// and a genuine 2-D matrix is unit-agnostic too, so this only fires for a widened
// 1-D list.

/** The single unit shared by a matrix's UnitCell cells (dim + a shared display id
 *  when every tagged cell agrees). `null` = nothing tagged; a `#UNIT!` = the tagged
 *  cells carry different dimensions (mixed units in one list). */
function elemUnitOf(m: Mat): { dim: Dim; display?: string } | null | SolError {
  let dim: Dim | null = null;
  let display: string | undefined;
  let displaySet = false;
  for (const row of m) for (const c of row) {
    if (!isUnitCell(c)) continue;
    const cell = c as unknown as UnitCell;
    if (dim === null) dim = cell.dim;
    else if (!dimEqual(dim, cell.dim)) return unitError("Can't fold a list with mixed units.");
    if (!displaySet) { display = cell.display; displaySet = true; }
    else if (display !== cell.display) display = undefined; // displays disagree → drop it
  }
  return dim === null ? null : { dim, display };
}

/** Strip UnitCells to base-SI magnitudes (other kinds pass through) so the numeric
 *  fold never sees an object. */
function stripCells(m: Mat): Mat {
  return m.map((row) => row.map((c) => (isUnitCell(c) ? (c as unknown as UnitCell).value : c)));
}

/** The result dimension of a fold/aggregate formula given the input's element dim.
 *  `dimVars` are the formula variables to bind to that dim (REDUCE: acc, value;
 *  BYROW/BYCOL: values); every other variable (a step / index) stays dimensionless.
 *  Returns the result dim, a `#UNIT!` conflict, or `null` (indeterminate → no tag). */
function foldResultDim(expr: string, dimVars: string[], elemDim: Dim): Dim | SolError | null {
  const ast = parseFormula(expr);
  if (!ast) return null;
  const env: DimEnv = {};
  for (const v of dimVars) env[v] = elemDim;
  const r = dimEval(ast, env);
  return r; // Dim | SolError | null
}

/** The formula text a lambda-family node is folding with — a wired lambda's source
 *  body, else the inline formula (or its fallback). Used for the dimensional twin. */
function foldExpr(lam: unknown, inline: string | undefined, fallback: string): string {
  if (isLambdaValue(lam)) return (lam as LambdaValue).expr || fallback;
  return inline && inline.trim() ? inline : fallback;
}

/** Re-tag a numeric fold result with a determined dimension, preserving the input
 *  list's display unit when the dimension is unchanged (a sum of km stays km). A
 *  non-number / dimensionless / indeterminate result is returned untouched. */
function retagFold(
  out: Cell,
  dr: Dim | SolError | null,
  elem: { dim: Dim; display?: string },
): Cell | UnitCell {
  if (typeof out !== "number" || dr === null || isSolError(dr) || isDimensionless(dr)) return out;
  const display = dimEqual(dr, elem.dim) ? elem.display : undefined;
  return tagDim(out, dr, display);
}

// ─── MAP ────────────────────────────────────────────────────────────────────────
// Like Excel's MAP, takes up to three arrays zipped through one lambda: `value` is
// the first table's cell, `value2`/`value3` the optional second/third tables'. An
// extra table must match the first's shape, or be 1×1 (a wired scalar widens to
// 1×1), which broadcasts over every cell — Solenoid's stand-in for a captured
// constant.

export class MapTableNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
  // A wired lambda binds by name (D18); `value` is the primary, the rest optional.
  readonly lambdaSig = { vars: ["value", "value2", "value3", "row", "col"], required: 1 };
  width = 210;
  height = 270;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType }) {
    super("MapTable");
    this.label = init?.label ?? "MAP";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "value^2" };
    this.addInput("table", anyTableIn("Values (value)"));
    this.addInput("table2", anyTableIn("value2 (optional)"));
    this.addInput("table3", anyTableIn("value3 (optional)"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Mapped", "matrix", this.resultAs));
  }

  data(inputs: { table?: unknown[]; table2?: unknown[]; table3?: unknown[]; lambda?: unknown[] }): { result: Mat | SolError | null } {
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "value^2", ["value", "value2", "value3", "row", "col"], 5, true);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return fnError(err!, code); }
    if (!m) { this.cachedResult = null; this.cachedError = null; return { result: null }; }
    const extras: (Mat | null)[] = [toAnyMatrix(inputs.table2?.[0]), toAnyMatrix(inputs.table3?.[0])];
    for (const e of extras) {
      if (!e) continue;
      const oneByOne = e.length === 1 && (e[0]?.length ?? 0) === 1;
      if (!oneByOne && (e.length !== m.length || (e[0]?.length ?? 0) !== (m[0]?.length ?? 0))) {
        const msg = `Shape mismatch: ${e.length}×${e[0]?.length ?? 0} vs ${m.length}×${m[0]?.length ?? 0}`;
        this.cachedResult = null;
        this.cachedError = msg;
        return fnError(msg, "#SHAPE!");
      }
    }
    const pick = (e: Mat | null, i: number, j: number): Cell =>
      e ? (e.length === 1 && e[0].length === 1 ? e[0][0] : e[i][j]) : NaN;
    try {
      const out = m.map((row, i) =>
        row.map((x, j) => cell(fn(x, pick(extras[0], i, j), pick(extras[1], i, j), i + 1, j + 1))));
      this.cachedResult = out;
      this.cachedError = null;
      return { result: out };
    } catch {
      this.cachedResult = null;
      this.cachedError = "Evaluation error";
      return fnError("Evaluation error", "#VALUE!");
    }
  }
}

// ─── BYROW / BYCOL ────────────────────────────────────────────────────────────────

export type ByAxis = "row" | "col";

export class ByAxisNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  axis: ByAxis;
  resultAs: ResultType;
  stringLiterals: Record<string, string>;
  cachedResult: (Cell | UnitCell)[] | SolError | null = null;
  cachedError: string | null = null;
  // A wired lambda binds by name (D18); `values` is the row/column as a list.
  readonly lambdaSig = { vars: ["values"], required: 1 };
  width = 210;
  height = 218;

  constructor(init?: { label?: string; expr?: string; axis?: ByAxis; resultAs?: ResultType }) {
    super("ByAxis");
    this.axis = init?.axis ?? "row";
    this.label = init?.label ?? (this.axis === "row" ? "BYROW" : "BYCOL");
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "SUM(values)" };
    this.addInput("table", anyTableIn("Table"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Per-" + this.axis, "combo", this.resultAs));
  }

  data(inputs: { table?: unknown[]; lambda?: unknown[] }): { result: (Cell | UnitCell)[] | SolError | null } {
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "SUM(values)", ["values"], 1, true);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return fnError(err!, code); }
    if (!m || m.length === 0) { this.cachedResult = null; this.cachedError = null; return { result: null }; }
    // FC A4 — carry units over a 1-D list: strip the tagged cells for the numeric
    // reduction, then re-tag each per-vector result with the aggregate's dimension.
    const elem = elemUnitOf(m);
    if (isSolError(elem)) { this.cachedResult = elem; this.cachedError = null; return { result: elem }; }
    const mm = elem ? stripCells(m) : m;
    try {
      const vectors = this.axis === "row" ? mm : transpose(mm);
      let out: (Cell | UnitCell)[] = vectors.map((vec) => cell(fn(vec)));
      if (elem) {
        const dr = foldResultDim(foldExpr(inputs.lambda?.[0], this.stringLiterals.formula, "SUM(values)"), ["values"], elem.dim);
        if (isSolError(dr)) { this.cachedResult = dr; this.cachedError = null; return { result: dr }; }
        out = out.map((c) => retagFold(c as Cell, dr, elem));
      }
      this.cachedResult = out;
      this.cachedError = null;
      return { result: out };
    } catch {
      this.cachedResult = null;
      this.cachedError = "Evaluation error";
      return fnError("Evaluation error", "#VALUE!");
    }
  }
}

// ─── REDUCE ───────────────────────────────────────────────────────────────────────
// Folds every cell (row-major, matching Excel) into one value, starting from
// Initial. The `Values` input widens any shape to a matrix, so REDUCE over a
// plain list is the everyday case and a matrix folds across all cells. The fold
// can be textual (`acc & value` with an Initial of "") or numeric.

export class ReduceLambdaNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Cell | UnitCell | SolError | null = null;
  cachedError: string | null = null;
  // Wired lambdas bind to (acc, value, step) by name (D18) — the card advises it.
  readonly lambdaSig = { vars: ["acc", "value", "step"], required: 2 };
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("ReduceLambda");
    this.label = init?.label ?? "REDUCE";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "acc + value" };
    if (init?.literals) this.literals = { ...init.literals };
    this.addInput("initial", anyIn("Initial"));
    this.addInput("table", anyTableIn("Values"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Result", "scalar", this.resultAs));
  }

  data(inputs: { initial?: unknown[]; table?: unknown[]; lambda?: unknown[] }): { result: Cell | UnitCell | SolError | null } {
    const initialRaw = readInput(inputs.initial as (unknown[] | undefined), this.literals.initial ?? 0);
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "acc + value", ["acc", "value", "step"], 3, true);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return fnError(err!, code); }
    if (!m) { this.cachedResult = null; this.cachedError = null; return { result: null }; }
    // FC A4 — carry units over a 1-D list: strip the tagged cells (and the initial)
    // for the numeric fold, then re-tag the scalar result with the fold's dimension.
    const elem = elemUnitOf(m);
    if (isSolError(elem)) { this.cachedResult = elem; this.cachedError = null; return { result: elem }; }
    const mm = elem ? stripCells(m) : m;
    const initial = isUnitCell(initialRaw) ? magnitudeOf(initialRaw) : initialRaw;
    try {
      let acc: unknown = initial;
      let i = 0;
      for (const row of mm) for (const x of row) acc = fn(acc, x, ++i);
      let out: Cell | UnitCell = cell(acc);
      if (elem) {
        const dr = foldResultDim(foldExpr(inputs.lambda?.[0], this.stringLiterals.formula, "acc + value"), ["acc", "value"], elem.dim);
        if (isSolError(dr)) { this.cachedResult = dr; this.cachedError = null; return { result: dr }; }
        out = retagFold(out as Cell, dr, elem);
      }
      this.cachedResult = out;
      this.cachedError = null;
      return { result: out };
    } catch {
      this.cachedResult = null;
      this.cachedError = "Evaluation error";
      return fnError("Evaluation error", "#VALUE!");
    }
  }
}

// ─── SCAN ───────────────────────────────────────────────────────────────────────
// REDUCE's running-intermediate twin: the SAME row-major fold, but it EMITS the
// accumulator after every cell, so the output keeps the input's shape (Excel
// SCAN). A running total is `acc + value` from Initial 0; a running max is
// `MAX(acc, value)`; text builds with `acc & value` from "". REDUCE gives only the
// final value, so this covers the arbitrary-formula case the fixed-op Cumulative
// can't.

export class ScanLambdaNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
  // Wired lambdas bind to (acc, value, step) by name (D18) — the card advises it.
  readonly lambdaSig = { vars: ["acc", "value", "step"], required: 2 };
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("ScanLambda");
    this.label = init?.label ?? "SCAN";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "acc + value" };
    if (init?.literals) this.literals = { ...init.literals };
    this.addInput("initial", anyIn("Initial"));
    this.addInput("table", anyTableIn("Values"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Scanned", "matrix", this.resultAs));
  }

  data(inputs: { initial?: unknown[]; table?: unknown[]; lambda?: unknown[] }): { result: Mat | SolError | null } {
    const initial = readInput(inputs.initial as (unknown[] | undefined), this.literals.initial ?? 0);
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "acc + value", ["acc", "value", "step"], 3, true);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return fnError(err!, code); }
    if (!m) { this.cachedResult = null; this.cachedError = null; return { result: null }; }
    try {
      let acc: unknown = initial;
      let i = 0;
      // The fold carries the RAW accumulator (fn's return); each output cell is
      // only its normalized snapshot — normalizing the carried acc would corrupt
      // the fold (e.g. a valid intermediate flattened to null).
      const out: Mat = m.map((row) => row.map((x) => { acc = fn(acc, x, ++i); return cell(acc); }));
      this.cachedResult = out;
      this.cachedError = null;
      return { result: out };
    } catch {
      this.cachedResult = null;
      this.cachedError = "Evaluation error";
      return fnError("Evaluation error", "#VALUE!");
    }
  }
}

// ─── MAKEARRAY ────────────────────────────────────────────────────────────────────

const MAKEARRAY_MAX_CELLS = 40000;

export class MakeArrayNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
  // A wired lambda binds by name (D18); `row`,`col` are the 1-based indices.
  readonly lambdaSig = { vars: ["row", "col"], required: 2 };
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("MakeArray");
    this.label = init?.label ?? "MAKEARRAY";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "row * col" };
    if (init?.literals) this.literals = { ...init.literals };
    this.addInput("rows", numIn("Rows"));
    this.addInput("cols", numIn("Cols"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Array", "matrix", this.resultAs));
  }

  data(inputs: { rows?: number[]; cols?: number[]; lambda?: unknown[] }): { result: Mat | SolError | null } {
    // A blank dimension leaves the array's SHAPE unknown; the `< 1` guard below
    // already answers blank for a non-positive size, so 0 routes into it.
    const rowsRaw = readInput(inputs.rows, this.literals.rows ?? 0);
    const colsRaw = readInput(inputs.cols, this.literals.cols ?? 0);
    const rows = rowsRaw === null ? 0 : Math.round(rowsRaw);
    const cols = colsRaw === null ? 0 : Math.round(colsRaw);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "row * col", ["row", "col"], 2, true);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return fnError(err!, code); }
    if (rows < 1 || cols < 1) { this.cachedResult = null; this.cachedError = null; return { result: null }; }
    if (rows * cols > MAKEARRAY_MAX_CELLS) {
      const msg = `Too large: ${rows}×${cols}`;
      this.cachedResult = null;
      this.cachedError = msg;
      return fnError(msg, "#OVERFLOW!");
    }
    try {
      const out: Mat = [];
      for (let i = 1; i <= rows; i++) {
        const row: Cell[] = [];
        for (let j = 1; j <= cols; j++) row.push(cell(fn(i, j)));
        out.push(row);
      }
      this.cachedResult = out;
      this.cachedError = null;
      return { result: out };
    } catch {
      this.cachedResult = null;
      this.cachedError = "Evaluation error";
      return fnError("Evaluation error", "#VALUE!");
    }
  }
}
