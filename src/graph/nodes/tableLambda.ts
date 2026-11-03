// [[B14]], [[C50]]
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, anyIn, anyTableIn, lambdaIn, resultOut, resultSocket, type ResultType, type ResultDim } from "./shared";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { type SolError } from "../errorValue";
import type { UnitCell } from "../unitValue";

// ─── 2D LAMBDA family: MAP / BYROW / BYCOL / MAKEARRAY / REDUCE / SCAN ─────────

type Cell = number | string | boolean | null | SolError;

type FollowsResult = GraphNode & { resultAs: ResultType; lastResultShape: string; lastResultFamily?: ResultType };

/** The body's answer named its family (`lastResultShape`, "rank|family"): Auto takes it, after the pass, and the cables
 *  downstream follow ([[C136]] typesKnownAfterCalc, [[C137]] datesNeverSerials). */
function followResult(node: FollowsResult, dim: ResultDim): void {
  const family = node.lastResultShape.split("|")[1];
  node.lastResultFamily = family === "number" || family === "text" || family === "date" ? family : undefined;
  if (node.resultAs !== "auto") return;
  const want = resultSocket(dim, node.lastResultFamily ?? "auto");
  queueMicrotask(() => {
    void (async () => {
      const out = node.outputs.result;
      if (!out || out.socket === want) return;
      out.socket = want;
      const editor = getOwningEditor(node.id);
      const view = getOwningView(node.id);
      if (editor?.getNode(node.id)) await retypeOutputCables(editor, view, node.id, "result");
      await view?.rerenderNode(node.id);
    })();
  });
}
type Mat = Cell[][];

// ─── MAP ────────────────────────────────────────────────────────────────────────

export class MapTableNode extends GraphNode {
  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
  /** The body's last answer as `rank|family`, which an Auto result follows (`coreWatch`). */
  lastResultShape = "1|";
  lastResultFamily?: ResultType;
  static coreWatch = "lastResultShape";
  coreWatched(): void { followResult(this, "matrix"); }
  readonly lambdaSig = { vars: ["value", "value2", "value3", "row", "col"], required: 1 };
  width = 210;
  height = 270;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType }) {
    super("MapTable");
    this.label = init?.label ?? "MAP";
    this.resultAs = init?.resultAs ?? "auto";
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
export class ByAxisNode extends GraphNode {
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
  /** The body's last answer as `rank|family`, which an Auto result follows (`coreWatch`). */
  lastResultShape = "1|";
  lastResultFamily?: ResultType;
  static coreWatch = "lastResultShape";
  coreWatched(): void { followResult(this, this.resultDim); }
  readonly lambdaSig = { vars: ["values"], required: 1 };
  width = 210;
  height = 218;

  constructor(init?: { label?: string; expr?: string; op?: ByAxis; resultAs?: ResultType }) {
    super("ByAxis");
    this.op = init?.op ?? "row";
    this.label = init?.label ?? "";
    this.resultAs = init?.resultAs ?? "auto";
    this.stringLiterals = { formula: init?.expr ?? "SUM(values)" };
    this.addInput("table", anyTableIn("Table"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut(ByAxisNode.labelFor(this.op), ByAxisNode.dimFor(this.op), this.resultAs));
  }

  /** Retypes the output in place and fires no connection event, so the component follows with retypeOutputCables. */
  setOp(next: ByAxis): boolean {
    if (next === this.op) return false;
    this.op = next;
    const spec = resultOut(ByAxisNode.labelFor(next), ByAxisNode.dimFor(next), this.resultAs === "auto" ? this.lastResultFamily ?? "auto" : this.resultAs);
    this.outputs.result!.socket = spec.socket;
    this.outputs.result!.label = spec.label;
    return true;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: (Cell | UnitCell)[] | (Cell | UnitCell)[][] | SolError | null };
  }
}

// ─── REDUCE ───────────────────────────────────────────────────────────────────────

export class ReduceLambdaNode extends GraphNode {
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
  /** The body's last answer as `rank|family`, which an Auto result follows (`coreWatch`). */
  lastResultShape = "1|";
  lastResultFamily?: ResultType;
  static coreWatch = "lastResultShape";
  coreWatched(): void { followResult(this, "scalar"); }
  readonly lambdaSig = { vars: ["acc", "value", "step"], required: 2 };
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("ReduceLambda");
    this.label = init?.label ?? "REDUCE";
    this.resultAs = init?.resultAs ?? "auto";
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

export class ScanLambdaNode extends GraphNode {
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
  /** The body's last answer as `rank|family`, which an Auto result follows (`coreWatch`). */
  lastResultShape = "1|";
  lastResultFamily?: ResultType;
  static coreWatch = "lastResultShape";
  coreWatched(): void { followResult(this, "matrix"); }
  readonly lambdaSig = { vars: ["acc", "value", "step"], required: 2 };
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("ScanLambda");
    this.label = init?.label ?? "SCAN";
    this.resultAs = init?.resultAs ?? "auto";
    this.stringLiterals = { formula: init?.expr ?? "acc + value" };
    if (init?.literals) this.literals = { ...init.literals };
    this.addInput("initial", anyIn("Initial"));
    this.addInput("table", anyTableIn("Values"));
    this.addInput("lambda", lambdaIn("Lambda"));
    this.addOutput("result", resultOut("Scanned", "matrix", this.resultAs));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Mat | SolError | null };
  }
}

// ─── MAKEARRAY ────────────────────────────────────────────────────────────────────

export class MakeArrayNode extends GraphNode {
  /** Receives UnitCell tags intact and runs the dimension algebra itself. */
  unitAware = true;
  label: string;
  resultAs: ResultType;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string>;
  cachedResult: Mat | SolError | null = null;
  cachedError: string | null = null;
  /** The body's last answer as `rank|family`, which an Auto result follows (`coreWatch`). */
  lastResultShape = "1|";
  lastResultFamily?: ResultType;
  static coreWatch = "lastResultShape";
  coreWatched(): void { followResult(this, "matrix"); }
  readonly lambdaSig = { vars: ["row", "col"], required: 2 };
  width = 210;
  height = 246;

  constructor(init?: { label?: string; expr?: string; resultAs?: ResultType; literals?: Record<string, number> }) {
    super("MakeArray");
    this.label = init?.label ?? "MAKEARRAY";
    this.resultAs = init?.resultAs ?? "auto";
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
