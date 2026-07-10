import { ClassicPreset } from "rete";
import { numIn, anyIn, anyTableIn, lambdaIn, resultOut, type ResultType } from "./shared";
import { toAnyMatrix } from "./coerce";
import { compilePositional } from "../excelFormula";
import { isLambdaValue } from "./lambda";
import { solError, isSolError, type SolError, type SolErrorCode } from "../errorValue";

// ─── 2D LAMBDA family: MAP / BYROW / BYCOL / MAKEARRAY / REDUCE ─────────────────
// Excel's MAP/BYROW/BYCOL/MAKEARRAY/REDUCE take a LAMBDA. Each node holds its
// formula as a string, typed inline in the node's "Formula" field (or the big
// FormulaPopup editor); a wired LAMBDA value supersedes it. The old third
// path — formula TEXT piped from a Text Input through a "Formula" string
// socket — was removed 2026-07-09: the popup + the lambda socket cover both
// authoring paths, and reuse-across-nodes is the LAMBDA node's job.
// Fixed variables:
//   MAP        → `x` (cell value; `y`,`z` from optional 2nd/3rd tables), plus
//                `r`,`c` (1-based position)
//   BYROW/BYCOL→ `v` (the row/column as a list — reduce it with SUM/MAX/…)
//   MAKEARRAY  → `r`,`c` (1-based indices)
//   REDUCE     → `acc` (running value), `x` (current cell), plus `i` (1-based)
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
 *  flows whole into `SUM(v)`. */
export function compileLambda(expr: string, varNames: string[]): LambdaFn | null {
  return compilePositional(expr, varNames) as LambdaFn | null;
}

/**
 * Resolve the function a lambda-family node runs. A wired LAMBDA value wins
 * (its declared params bind positionally to the first of this node's call
 * args, Excel-style); otherwise the inline formula text compiles over the
 * node's fixed variable names. `provided` is how many positional values
 * the node passes per call — a lambda declaring more can't be satisfied.
 */
// `err` is the short message shown inline in the node (FormulaError); `code` tags
// the same failure for the propagating SolError so downstream nodes show the red
// badge. An arity mismatch is a #VALUE! (wrong operand), a bad formula a #SYNTAX!.
function resolveFn(
  lam: unknown, inline: string | undefined,
  fallback: string, varNames: string[], provided: number,
): { fn: LambdaFn | null; err: string | null; code: SolErrorCode } {
  if (isLambdaValue(lam)) {
    if (lam.params.length > provided) {
      return { fn: null, err: `Lambda takes ${lam.params.length} values; this node passes ${provided}`, code: "#VALUE!" };
    }
    return { fn: lam.fn as LambdaFn, err: null, code: "#VALUE!" };
  }
  const fn = compileLambda(inline && inline.trim() ? inline : fallback, varNames);
  return fn ? { fn, err: null, code: "#SYNTAX!" } : { fn: null, err: "Syntax error", code: "#SYNTAX!" };
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
 *  text, a BOOLEAN (P7 logical — `MAP(x, x>2)` was an all-null matrix before,
 *  audit finding 27) and a finite number (a date serial is one) pass through;
 *  anything else (non-finite, undefined, a wired-in null) → `null`, the MISSING
 *  sentinel (skipped by aggregators). Lists/matrices now carry both kinds. */
function cell(v: unknown): Cell {
  if (isSolError(v)) return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ─── MAP ────────────────────────────────────────────────────────────────────────
// Like Excel's MAP, takes up to three arrays zipped through one lambda: `x` is
// the first table's cell, `y`/`z` the optional second/third tables'. An extra
// table must match the first's shape, or be 1×1 (a wired scalar widens to 1×1),
// which broadcasts over every cell — Solenoid's stand-in for a captured constant.

export class MapTableNode extends ClassicPreset.Node {
  label: string;
  resultAs: ResultType;
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
  width = 210;
  height = 270;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType }) {
    super("MapTable");
    this.label = init?.label ?? "MAP";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "x^2" };
    this.addInput("table", anyTableIn("Values (x)"));
    this.addInput("table2", anyTableIn("y (optional)"));
    this.addInput("table3", anyTableIn("z (optional)"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Mapped", "matrix", this.resultAs));
  }

  data(inputs: { table?: unknown[]; table2?: unknown[]; table3?: unknown[]; lambda?: unknown[] }): { result: Mat | SolError | null } {
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "x^2", ["x", "y", "z", "r", "c"], 5);
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
  label: string;
  axis: ByAxis;
  resultAs: ResultType;
  stringLiterals: Record<string, string>;
  cachedResult: Cell[] | SolError | null = null;
  cachedError: string | null = null;
  width = 210;
  height = 218;

  constructor(init?: { label?: string; expr?: string; axis?: ByAxis; resultAs?: ResultType }) {
    super("ByAxis");
    this.axis = init?.axis ?? "row";
    this.label = init?.label ?? (this.axis === "row" ? "BYROW" : "BYCOL");
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "SUM(v)" };
    this.addInput("table", anyTableIn("Table"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Per-" + this.axis, "combo", this.resultAs));
  }

  data(inputs: { table?: unknown[]; lambda?: unknown[] }): { result: Cell[] | SolError | null } {
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "SUM(v)", ["v"], 1);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return fnError(err!, code); }
    if (!m || m.length === 0) { this.cachedResult = null; this.cachedError = null; return { result: null }; }
    try {
      const vectors = this.axis === "row" ? m : transpose(m);
      const out = vectors.map((vec) => cell(fn(vec)));
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
// can be textual (`acc & x` with an Initial of "") or numeric.

export class ReduceLambdaNode extends ClassicPreset.Node {
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Cell | SolError | null = null;
  cachedError: string | null = null;
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("ReduceLambda");
    this.label = init?.label ?? "REDUCE";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "acc + x" };
    if (init?.literals) this.literals = { ...init.literals };
    this.addInput("initial", anyIn("Initial"));
    this.addInput("table", anyTableIn("Values"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Result", "scalar", this.resultAs));
  }

  data(inputs: { initial?: unknown[]; table?: unknown[]; lambda?: unknown[] }): { result: Cell | SolError | null } {
    const initial = inputs.initial?.[0] ?? this.literals.initial ?? 0;
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "acc + x", ["acc", "x", "i"], 3);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return fnError(err!, code); }
    if (!m) { this.cachedResult = null; this.cachedError = null; return { result: null }; }
    try {
      let acc: unknown = initial;
      let i = 0;
      for (const row of m) for (const x of row) acc = fn(acc, x, ++i);
      const out = cell(acc);
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
// SCAN). A running total is `acc + x` from Initial 0; a running max is
// `MAX(acc, x)`; text builds with `acc & x` from "". REDUCE gives only the final
// value, so this covers the arbitrary-formula case the fixed-op Cumulative can't.

export class ScanLambdaNode extends ClassicPreset.Node {
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("ScanLambda");
    this.label = init?.label ?? "SCAN";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "acc + x" };
    if (init?.literals) this.literals = { ...init.literals };
    this.addInput("initial", anyIn("Initial"));
    this.addInput("table", anyTableIn("Values"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Scanned", "matrix", this.resultAs));
  }

  data(inputs: { initial?: unknown[]; table?: unknown[]; lambda?: unknown[] }): { result: Mat | SolError | null } {
    const initial = inputs.initial?.[0] ?? this.literals.initial ?? 0;
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "acc + x", ["acc", "x", "i"], 3);
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
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("MakeArray");
    this.label = init?.label ?? "MAKEARRAY";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "r * c" };
    if (init?.literals) this.literals = { ...init.literals };
    this.addInput("rows", numIn("Rows"));
    this.addInput("cols", numIn("Cols"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Array", "matrix", this.resultAs));
  }

  data(inputs: { rows?: number[]; cols?: number[]; lambda?: unknown[] }): { result: Mat | SolError | null } {
    const rows = Math.round(inputs.rows?.[0] ?? this.literals.rows ?? 0);
    const cols = Math.round(inputs.cols?.[0] ?? this.literals.cols ?? 0);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "r * c", ["r", "c"], 2);
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
