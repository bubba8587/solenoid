// [[B14]], [[C50]]
import { ClassicPreset } from "rete";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, anyIn, anyTableIn, lambdaIn, resultOut, readInput, type ResultType, type ResultDim } from "./shared";
import { toAnyMatrix } from "./coerce";
import { compilePositional, formulaSyntaxHint, extractVariables } from "../excelFormula";
import { isLambdaValue } from "./lambda";
import { solError, isSolError, type SolError, type SolErrorCode } from "../errorValue";
import { guardFinite } from "../valueKinds";
import type { UnitCell } from "../unitValue";

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

function cell(v: unknown): Cell {
  if (isSolError(v)) return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v;
  return typeof v === "number" ? guardFinite(v, [v]) : null;
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Mat | SolError | null };
  }
}

// ─── BYROW / BYCOL ────────────────────────────────────────────────────────────────

export type ByAxis = "row" | "col";
export const BY_AXIS_OP_META: Record<ByAxis, { label: string }> = { row: { label: "BYROW" }, col: { label: "BYCOL" } };

/** BYROW answers a one-column table beside the rows it came from, BYCOL a list ([[D85]] columnsStayColumns). */
export class ByAxisNode extends ClassicPreset.Node {
  static dimFor(op: ByAxis): ResultDim { return op === "row" ? "matrix" : "combo"; }
  static labelFor(op: ByAxis): string { return op === "row" ? "Per row" : "Per column"; }
  get resultDim(): ResultDim { return ByAxisNode.dimFor(this.op); }

  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  op: ByAxis;
  resultAs: ResultType;
  stringLiterals: Record<string, string>;
  cachedResult: (Cell | UnitCell)[] | (Cell | UnitCell)[][] | SolError | null = null;
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
    this.addOutput("result", resultOut(ByAxisNode.labelFor(this.op), ByAxisNode.dimFor(this.op), this.resultAs));
  }

  /** Retypes the output in place and fires no connection event, so the component follows with retypeOutputCables. */
  setOp(next: ByAxis): boolean {
    if (next === this.op) return false;
    this.op = next;
    const spec = resultOut(ByAxisNode.labelFor(next), ByAxisNode.dimFor(next), this.resultAs);
    this.outputs.result!.socket = spec.socket;
    this.outputs.result!.label = spec.label;
    return true;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: (Cell | UnitCell)[] | (Cell | UnitCell)[][] | SolError | null };
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Cell | UnitCell | SolError | null };
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Mat | SolError | null };
  }
}
