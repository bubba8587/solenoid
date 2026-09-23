// [[C13]], [[C50]]
import { ClassicPreset } from "rete";
import { numIn, anyIn, anyTableIn, lambdaIn, resultOut, readInput, type ResultType } from "./shared";
import { toAnyMatrix } from "./coerce";
import { compilePositional, parseFormula, formulaSyntaxHint, extractVariables } from "../excelFormula";
import { isLambdaValue, type LambdaValue } from "./lambda";
import { solError, isSolError, type SolError, type SolErrorCode } from "../errorValue";
import { isUnitCell, tagDim, magnitudeOf, unitError, type UnitCell } from "../unitValue";
import { dimEval, type DimEnv } from "../unitDimExpr";
import { type Dim, dimEqual, isDimensionless } from "../dimension";

// ─── 2D LAMBDA family: MAP / BYROW / BYCOL / MAKEARRAY / REDUCE / SCAN ─────────

type Cell = number | string | boolean | null | SolError;
type Mat = Cell[][];
type LambdaFn = (...args: unknown[]) => unknown;

export function compileLambda(expr: string, varNames: string[]): LambdaFn | null {
  return compilePositional(expr, varNames) as LambdaFn | null;
}

/** `err` is the inline node message; `code` tags the propagating SolError. */
export function resolveFn(
  lam: unknown, inline: string | undefined,
  fallback: string, varNames: string[], provided: number,
  byName = false,
): { fn: LambdaFn | null; err: string | null; code: SolErrorCode } {
  if (isLambdaValue(lam)) {
    if (byName) {
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

/** Returns the tagged error downstream while cachedResult stays null, so the card keeps the richer inline message. */
function fnError(err: string, code: SolErrorCode): { result: SolError } {
  return { result: solError(code, err) };
}

function transpose<T>(m: T[][]): T[][] {
  const cols = m[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, j) => m.map((row) => row[j]));
}

function cell(v: unknown): Cell {
  if (isSolError(v)) return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ─── Unit carry over a 1-D list ───────────────────────────────────────────────
// Only a widened 1-D list carries units; the matrix producers (MAP, MAKEARRAY, SCAN) are unit-agnostic.

/** Null when nothing is tagged and #UNIT! when tagged cells disagree on dimension; the display survives only when every tagged cell agrees. */
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
    else if (display !== cell.display) display = undefined;
  }
  return dim === null ? null : { dim, display };
}

function stripCells(m: Mat): Mat {
  return m.map((row) => row.map((c) => (isUnitCell(c) ? (c as unknown as UnitCell).value : c)));
}

/** `dimVars` take the element dim; every other variable is dimensionless. */
function foldResultDim(expr: string, dimVars: string[], elemDim: Dim): Dim | SolError | null {
  const ast = parseFormula(expr);
  if (!ast) return null;
  const env: DimEnv = {};
  for (const v of dimVars) env[v] = elemDim;
  const r = dimEval(ast, env);
  return r;
}

function foldExpr(lam: unknown, inline: string | undefined, fallback: string): string {
  if (isLambdaValue(lam)) return (lam as LambdaValue).expr || fallback;
  return inline && inline.trim() ? inline : fallback;
}

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

export class MapTableNode extends ClassicPreset.Node {
  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
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
export const BY_AXIS_OP_META: Record<ByAxis, { label: string }> = { row: { label: "BYROW" }, col: { label: "BYCOL" } };

export class ByAxisNode extends ClassicPreset.Node {
  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  op: ByAxis;
  resultAs: ResultType;
  stringLiterals: Record<string, string>;
  cachedResult: (Cell | UnitCell)[] | SolError | null = null;
  cachedError: string | null = null;
  readonly lambdaSig = { vars: ["values"], required: 1 };
  width = 210;
  height = 218;

  constructor(init?: { label?: string; expr?: string; op?: ByAxis; resultAs?: ResultType }) {
    super("ByAxis");
    this.op = init?.op ?? "row";
    this.label = init?.label ?? "";
    this.resultAs = init?.resultAs ?? "number";
    this.stringLiterals = { formula: init?.expr ?? "SUM(values)" };
    this.addInput("table", anyTableIn("Table"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Per-" + this.op, "combo", this.resultAs));
  }

  data(inputs: { table?: unknown[]; lambda?: unknown[] }): { result: (Cell | UnitCell)[] | SolError | null } {
    const m = toAnyMatrix(inputs.table?.[0]);
    const { fn, err, code } = resolveFn(
      inputs.lambda?.[0], this.stringLiterals.formula,
      "SUM(values)", ["values"], 1, true);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return fnError(err!, code); }
    if (!m || m.length === 0) { this.cachedResult = null; this.cachedError = null; return { result: null }; }
    const elem = elemUnitOf(m);
    if (isSolError(elem)) { this.cachedResult = elem; this.cachedError = null; return { result: elem }; }
    const mm = elem ? stripCells(m) : m;
    try {
      const vectors = this.op === "row" ? mm : transpose(mm);
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

export class ReduceLambdaNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    table: "Cells fold in row order, left to right across each row.",
  };

  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Cell | UnitCell | SolError | null = null;
  cachedError: string | null = null;
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

export class ScanLambdaNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    table: "Cells fold in row order, left to right across each row.",
  };

  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
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
      // The carried accumulator stays raw: normalizing it would flatten a valid intermediate to null.
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
  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
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
