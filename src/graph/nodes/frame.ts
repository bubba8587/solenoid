// [[B17]], [[C48]]
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { chartOut, adoptiveListOut } from "./shared";
import type { ChartValue } from "../chartValue";
import { numIn, dateIn, numListOut, tableOut, strTableOut, dateTableOut, logicalTableOut, listIn, listOut, strIn, strComboIn, strOut, strListIn, strListOut, dateListIn, dateListOut, logicalListIn, logicalListOut, frameIn, frameOut, cubeIn, cubeOut, cubeAdoptIn, tableAdoptOut, anyIn, anyDataIn, staticTrueAnyOut, trueAnyOut, adoptiveTableIn, adoptiveListIn, lambdaIn } from "./shared";
import { setting, required, LEFT_OUT } from "../inputRoles";
import type { PassthroughSpec, ProjectContext } from "./passthrough";
import { dropInputCables } from "../components/cablePrune";
import { getOwningView } from "../activeGraph";
import type { FrameHint } from "../frameHint";
import { SolenoidSocket, comboOfFamily, type SocketDataType } from "../sockets";
import { solError, type SolError } from "../errorValue";
import {
  colTypeForSocket,
  addColumn, makeHeaders,
  frameFromInputText, parseFrameSource, frameSourceToText,
  isFrameValue,
  type FrameValue, type FrameColType,
} from "../frame";
import type { FilterCombine, JoinHow, AsofDirection, AggOp, DecisionNormalize, LookupMatchMode, LookupSearchMode } from "../frameOps";
import { pairIdsFromKeys } from "./logic";
import type { FilterCondConfig } from "../frameOps";
import type { AllocateMode } from "./allocateOps";
import { WINDOW_FN_NEEDS_COLUMN, WINDOW_FN_NEEDS_N, type CorrMethod, type WindowFn } from "../frameOps";
export type { WindowFn } from "../frameOps";
export type { CorrMethod } from "../frameOps";
import { frameFnOnCore, bindSchema, type FrameRef } from "../frameBackend";
import { getRecalcGen } from "../process";
import {
  shapeOf, shapeOfJoin, shapeOfAppend, shapeOfAddIndex, shapeOfSplitColumn, shapeOfFrameValue,
  emptyFrameOf, totalLabelledKeys, sampleShapeOnCore, type Shape, type ShapeColumn,
} from "../frameShape";
import { csvList, type FrameShapeContext } from "./frameShapeHook";
import type { ColumnPickerSpec } from "./columnPickerHook";
import type { CubeValue, CubeCell } from "../frame";
import { type UnitCell } from "../unitValue";
import { readPivotView, type PivotViewOptions } from "../pivotLayout";
import { setDescribeTiles, type DescribeTile } from "../describeProfile";

/** A frame computation's shape: the core answers it over no rows. */
/** Sample inputs for a card whose columns don't depend on its input's: options to score, and people who paid. */
const SAMPLE_OPTIONS: Shape = { columns: [{ name: "Option", type: "string" }, { name: "Score", type: "number" }] };
const SAMPLE_PEOPLE: Shape = { columns: [{ name: "Person", type: "string" }, { name: "Paid", type: "number" }] };

function shapeOnCore(name: string, inputs: readonly Shape[], args: unknown[] = []): Shape | null {
  const r = frameFnOnCore(name, inputs.map(emptyFrameOf), args);
  return r && "frame" in r ? shapeOfFrameValue(r.frame) : null;
}

/** What a frame verb answers: a lazy frame, a frame or a Cube value, an error, or nothing. */
type FrameOut = FrameRef | FrameValue | CubeValue | SolError | null;

type Inputs = Record<string, unknown[] | undefined>;

// ─── FRAME INPUT ─────────────────────────────────────────────────────────────

export const lambdaSocketName = (key: string): string => `λ${key.replace(/^fn/, "")}`;

export class FrameInputNode extends GraphNode {
  label: string;
  cachedResult: FrameValue | null = null;
  frameText: string;
  /** Holds `layout`, the Form view's Record layout, and `cardLayout`, the Cards view's; this declaration is what lets load restore them. */
  stringLiterals: Record<string, string> = {};
  /** Hiding keeps the text but makes it inert, so read `activeLayout`, never `stringLiterals.layout`. */
  layoutHidden: boolean;
  /** The same for `cardLayout`: read `activeCardLayout`. */
  cardLayoutHidden: boolean;
  lambdaKeys: string[] = [];
  // Reserves the full default card (header, both add rows, the capped preview) so Tidy never stacks a neighbor into it.
  width = 240; height = 280;

  constructor(init?: { label?: string; frameText?: string; lambdaKeys?: string[]; layoutHidden?: boolean; cardLayoutHidden?: boolean }) {
    super("FrameInput");
    this.label = init?.label ?? "Frame Input";
    this.frameText = init?.frameText ?? "A, B\n1, 2\n3, 4";
    this.layoutHidden = init?.layoutHidden ?? false;
    this.cardLayoutHidden = init?.cardLayoutHidden ?? false;
    if (Array.isArray(init?.lambdaKeys)) this.lambdaKeys = init.lambdaKeys.filter((k) => typeof k === "string");
    for (const k of this.lambdaKeys) this.addInput(k, lambdaIn(lambdaSocketName(k)));
    this.addOutput("frame", frameOut("Frame"));
  }

  get activeLayout(): string | undefined {
    return this.layoutHidden ? undefined : this.stringLiterals.layout;
  }

  get activeCardLayout(): string | undefined {
    return this.cardLayoutHidden ? undefined : this.stringLiterals.cardLayout;
  }

  addValueInput(): string {
    const next = this.lambdaKeys.reduce((m, k) => Math.max(m, Number(k.replace(/^fn/, "")) || 0), 0) + 1;
    const key = `fn${next}`;
    this.lambdaKeys.push(key);
    this.addInput(key, lambdaIn(lambdaSocketName(key)));
    return key;
  }

  removeValueInput(key: string): void {
    this.lambdaKeys = this.lambdaKeys.filter((k) => k !== key);
    if (this.inputs[key]) this.removeInput(key);
    const name = lambdaSocketName(key);
    const source = parseFrameSource(this.frameText);
    if (source.some((c) => c.expr?.trim() === name)) {
      this.frameText = frameSourceToText(source.map((c) => (c.expr?.trim() === name ? { ...c, expr: undefined } : c)));
    }
  }

  private _parsed: { text: string; source: ReturnType<typeof parseFrameSource>; shape?: Shape } | null = null;

  private parsedSource() {
    if (this._parsed?.text !== this.frameText) this._parsed = { text: this.frameText, source: parseFrameSource(this.frameText) };
    return this._parsed;
  }

  frameShape(): Shape {
    const parsed = this.parsedSource();
    return (parsed.shape ??= shapeOfFrameValue(frameFromInputText(this.frameText)));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { frame: FrameValue };
  }
}

// ─── DISTINCT ────────────────────────────────────────────────────────────────

export class DistinctNode extends GraphNode {
  label: string;
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  width = 180; height = 120;

  constructor(init?: { label?: string }) {
    super("Distinct");
    this.label = init?.label ?? "Distinct";
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addOutput("frame", tableAdoptOut("Unique"));
  }

  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── HEAD ────────────────────────────────────────────────────────────────────

export type HeadOp = "first" | "last" | "skip" | "range";

export const HEAD_OP_META: Record<HeadOp, { label: string; description: string }> = {
  first: { label: "First N",      description: "Keep the first N rows." },
  last:  { label: "Last N",       description: "Keep the last N rows." },
  skip:  { label: "Skip first N", description: "Remove the first N rows, keep the rest." },
  range: { label: "Rows M–N",     description: "Keep rows M through N, 1-based inclusive." },
};

export class HeadNode extends GraphNode {
  static inputRoles = { rows: setting(10), to: setting(LEFT_OUT, "end") };
  static socketDocs: Record<string, string> = {
    rows: "First, Last, and Skip read this as a row count. Rows M–N reads it as the 1-based start row.",
    to: "Only the Rows M–N operation reads this, as the last kept row.",
  };

  label: string;
  op: HeadOp;
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  literals: Record<string, number> = { rows: 10, to: 20 };
  width = 180; height = 175;

  constructor(init?: { label?: string; op?: HeadOp }) {
    super("Head");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "first";
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("rows", numIn("Rows"));
    this.addInput("to", numIn("To"));
    this.addOutput("frame", tableAdoptOut("Head"));
  }

  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── SORT FRAME ────────────────────────────────────────────────────────────────

export type FrameSortDir = "asc" | "desc";

export class SortFrameNode extends GraphNode {
  label: string;
  dir: FrameSortDir;
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  stringLiterals: Record<string, string> = { column: "" };
  width = 190; height = 175;

  constructor(init?: { label?: string; dir?: FrameSortDir }) {
    super("SortFrame");
    this.label = init?.label ?? "Frame Sort";
    this.dir = init?.dir ?? "asc";
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("column", strIn("Column"));
    this.addOutput("frame", tableAdoptOut("Sorted"));
  }

  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  columnPickers(): ColumnPickerSpec[] { return [{ key: "column", frameInput: "frame" }]; }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── FILTER FRAME ──────────────────────────────────────────────────────────────

export type { FilterCondConfig } from "../frameOps";

export class FilterFrameNode extends GraphNode {
  label: string;
  combine: FilterCombine;
  /** Keyed by the pair id, the suffix of `column${id}`. */
  condConfig: Record<string, FilterCondConfig> = {};
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["Column", "Value"];
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  stringLiterals: Record<string, string> = {};
  width = 210; height = 240;

  constructor(init?: {
    label?: string; combine?: FilterCombine;
    condConfig?: Record<string, FilterCondConfig>; valueKeys?: string[];
  }) {
    super("FilterFrame");
    this.label = init?.label ?? "Frame Filter";
    this.combine = init?.combine ?? "and";
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    const ids = pairIdsFromKeys(init?.valueKeys, "column");
    if (ids.length) {
      // Copy only live ids' config: this is where reload prunes the orphans that removal keeps for undo.
      for (const id of ids) this.addPairWithId(id);
      for (const id of ids) {
        const cfg = init?.condConfig?.[String(id)];
        if (cfg) this.condConfig[String(id)] = { ...cfg };
      }
    } else {
      this.addValuePair();
    }
    this.addOutput("frame", tableAdoptOut("Kept"));
    this.addOutput("dropped", tableAdoptOut("Dropped"));
  }

  private addPairWithId(id: number): void {
    this.addInput(`column${id}`, strIn(`Column ${id + 1}`));
    this.addInput(`value${id}`, anyIn(`Value ${id + 1}`));
    if (!this.condConfig[String(id)]) this.condConfig[String(id)] = { op: "gt" };
    this.nextPairId = Math.max(this.nextPairId, id + 1);
  }

  valuePairKeys(): Array<[string, string]> {
    return Object.keys(this.inputs)
      .filter((k) => k.startsWith("column"))
      .map((k) => { const id = k.slice(6); return [`column${id}`, `value${id}`] as [string, string]; });
  }

  addValuePair(): void {
    this.addPairWithId(this.nextPairId);
  }

  removeValuePair(aKey: string): void {
    const id = aKey.slice(6);
    this.removeInput(`column${id}`);
    this.removeInput(`value${id}`);
    delete this.stringLiterals[`column${id}`];
    delete this.stringLiterals[`value${id}`];
    // condConfig[id] stays so undoing the removal restores its op; reload prunes it.
  }

  passthrough(): PassthroughSpec[] {
    return [
      { output: "frame", inputs: ["frame"], combine: "single" },
      { output: "dropped", inputs: ["frame"], combine: "single" },
    ];
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut; dropped: FrameOut };
  }
}

// ─── JOIN ──────────────────────────────────────────────────────────────────────

export class JoinNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    leftKey: "A blank or error key never matches any row, and the two key columns must share one type.",
    rightKey: "An empty name reuses the left key's name for the right frame.",
    tolerance: "Only the as-of join reads this, as the widest key distance a match may span. An empty value allows any distance.",
    frame: "The right frame's non-key columns follow the left columns, and the key appears once, filled from whichever side has the row.",
  };

  label: string;
  how: JoinHow;
  asofDirection: AsofDirection;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { leftKey: "", rightKey: "" };
  literals: Record<string, number> = {};
  width = 210; height = 290;

  constructor(init?: { label?: string; how?: JoinHow; asofDirection?: AsofDirection }) {
    super("Join");
    this.label = init?.label ?? "Join";
    this.how = init?.how ?? "inner";
    this.asofDirection = init?.asofDirection ?? "backward";
    this.addInput("left", frameIn("Left"));
    this.addInput("right", frameIn("Right"));
    this.addInput("leftKey", strIn("Left key"));
    this.addInput("rightKey", strIn("Right key"));
    this.addInput("tolerance", numIn("Tolerance"));
    this.addOutput("frame", frameOut("Joined"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const left = ctx.inputShape("left");
    const right = ctx.inputShape("right");
    if (!left || !right || ctx.wired("leftKey") || ctx.wired("rightKey")) return null;
    const lk = (this.stringLiterals.leftKey ?? "").trim();
    const rk = (this.stringLiterals.rightKey ?? "").trim() || lk;
    if (lk === "") return null;
    return shapeOfJoin(left, right, { leftKey: lk, rightKey: rk, how: this.how });
  }

  columnPickers(): ColumnPickerSpec[] {
    return [{ key: "leftKey", frameInput: "left" }, { key: "rightKey", frameInput: "right" }];
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── COLUMNS (KEEP / DROP) ───────────────────────────────────────────────────

export type ColumnsOp = "keep" | "drop";

export const COLUMNS_OP_META: Record<ColumnsOp, { label: string; description: string; fx: string }> = {
  keep: { label: "Keep", fx: "KEEPCOLS", description: "Keep only the named columns, in the order given." },
  drop: { label: "Drop", fx: "DROPCOLS", description: "Remove the named columns; the rest pass through." },
};

export class ColumnsNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    columns: "Keep: an empty list passes the frame through unchanged, and a name the frame lacks is a #REF! error. Drop: names the frame lacks are ignored.",
  };

  label: string;
  op: ColumnsOp;
  stringLiterals: Record<string, string> = {};
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  width = 190; height = 150;

  constructor(init?: { label?: string; op?: ColumnsOp }) {
    super("Columns");
    this.op = init?.op ?? "keep";
    this.label = init?.label ?? "";
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("columns", strListIn("Columns"));
    this.addOutput("frame", tableAdoptOut("Frame"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("columns")) return null;
    const cols = csvList(this.stringLiterals.columns);
    if (this.op === "keep") return cols.length ? shapeOf({ kind: "select", columns: cols }, input) : input;
    return shapeOf({ kind: "drop", columns: cols }, input);
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── GROUP BY (FRAME) ──────────────────────────────────────────────────────────

// `pivotOnly` ops run only in the pivot assembly and stay out of the card dropdowns and search rows.
export const AGG_OP_META: Record<AggOp, { label: string; pivotOnly?: boolean }> = {
  sum: { label: "SUM" },
  avg: { label: "AVERAGE" },
  min: { label: "MIN" },
  max: { label: "MAX" },
  count: { label: "COUNT" },
  product: { label: "PRODUCT" },
  median: { label: "MEDIAN" },
  mode: { label: "MODE" },
  stdev: { label: "STDEV.S" },
  stdevp: { label: "STDEV.P" },
  var: { label: "VAR.S" },
  varp: { label: "VAR.P" },
  percentof: { label: "PERCENTOF", pivotOnly: true },
};

export class GroupByFrameNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    keys: "Groups keep first-seen row order, and blank key cells group together as their own group.",
  };

  label: string;
  agg: AggOp;
  totalDepth = 0;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "" };
  width = 200; height = 205;

  constructor(init?: { label?: string; agg?: AggOp; totalDepth?: number }) {
    super("GroupByFrame");
    this.label = init?.label ?? "GROUPBY";
    this.agg = init?.agg ?? "sum";
    this.totalDepth = init?.totalDepth ?? 0;
    this.addInput("frame", cubeAdoptIn("Frame / Cube"));
    this.addInput("keys", strListIn("Group by"));
    this.addInput("column", strIn("Aggregate"));
    this.addOutput("frame", frameOut("Grouped"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("keys") || ctx.wired("column")) return null;
    const keys = csvList(this.stringLiterals.keys);
    const col = (this.stringLiterals.column ?? "").trim();
    if (!keys.length || !col) return input;
    const shape = shapeOf({ kind: "groupBy", keys, aggs: [{ column: col, op: this.agg, as: col }] }, input);
    const labelled = totalLabelledKeys(this.totalDepth, keys.length);
    return { ...shape, columns: shape.columns.map((c, k) => (k < labelled ? { ...c, type: "string" } : c)) };
  }

  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── PIVOT / UNPIVOT ───────────────────────────────────────────────────────────

export class PivotNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    filter: "One cell per source row, in order. Only rows where the mask is TRUE feed the pivot.",
  };

  label: string;
  agg: AggOp;
  funcs: Record<string, AggOp> = {};
  rowTotalDepth = 0;
  colTotalDepth = 0;
  rowSort = 0;
  colSort = 0;
  relativeTo = 0;
  // Per field, the value keys to hide; ANDed with the wired `filter` mask.
  filterExclude: Record<string, string[]> = {};
  /** How the popup's Pivot view draws the output; display only. */
  pivotView: PivotViewOptions;
  /** Columns the Pivot view lists under each row group; display only ([[C127]] pivotView). */
  detailFields: string[] = [];
  cachedResult: FrameValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  sourceColumns: { name: string; type: FrameColType; distinct: string[] }[] = [];
  stringLiterals: Record<string, string> = { rowFields: "", colFields: "", values: "" };
  width = 220; height = 300;

  constructor(init?: {
    label?: string; agg?: AggOp; funcs?: Record<string, AggOp>;
    rowTotalDepth?: number; colTotalDepth?: number; rowSort?: number; colSort?: number; relativeTo?: number;
    filterExclude?: Record<string, string[]>;
    pivotView?: Partial<PivotViewOptions>;
    detailFields?: string[];
  }) {
    super("Pivot");
    this.pivotView = readPivotView(init?.pivotView);
    if (Array.isArray(init?.detailFields)) this.detailFields = init.detailFields.filter((n): n is string => typeof n === "string" && n !== "");
    this.label = init?.label ?? "PIVOTBY";
    this.agg = init?.agg ?? "sum";
    if (init?.funcs) this.funcs = { ...init.funcs };
    if (init?.filterExclude) this.filterExclude = { ...init.filterExclude };
    this.rowTotalDepth = init?.rowTotalDepth ?? 0;
    this.colTotalDepth = init?.colTotalDepth ?? 0;
    this.rowSort = init?.rowSort ?? 0;
    this.colSort = init?.colSort ?? 0;
    this.relativeTo = init?.relativeTo ?? 0;
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("rowFields", strListIn("Rows"));
    this.addInput("colFields", strListIn("Columns"));
    this.addInput("values", strListIn("Values"));
    this.addInput("filter", logicalListIn("Filter"));
    this.addOutput("frame", frameOut("Wide"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("rowFields") || ctx.wired("colFields") || ctx.wired("values")) return null;
    const valid = new Set(input.columns.map((c) => c.name));
    const rowFields = csvList(this.stringLiterals.rowFields).filter((f) => valid.has(f));
    const colFields = csvList(this.stringLiterals.colFields).filter((f) => valid.has(f));
    const values = csvList(this.stringLiterals.values).filter((f) => valid.has(f));
    if (!values.length) return input;
    const funcs = values.map((name) => this.funcs[name] ?? this.agg);
    return shapeOf({ kind: "pivot", rowFields, colFields, values, funcs, rowTotalDepth: this.rowTotalDepth }, input);
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

export class UnpivotNode extends GraphNode {
  label: string;
  stringLiterals: Record<string, string> = {};
  cachedResult: FrameValue | SolError | null = null;
  width = 200; height = 175;

  constructor(init?: { label?: string }) {
    super("Unpivot");
    this.label = init?.label ?? "Unpivot";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("idColumns", strListIn("Keep"));
    this.addInput("valueColumns", strListIn("Melt"));
    this.addOutput("frame", frameOut("Long"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("idColumns") || ctx.wired("valueColumns")) return null;
    const vals = csvList(this.stringLiterals.valueColumns);
    if (!vals.length) return input;
    return shapeOf({ kind: "unpivot", idColumns: csvList(this.stringLiterals.idColumns), valueColumns: vals }, input);
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── NEST / UNNEST (the flat ⟷ cube bridge) ───────────────────────────────────

export class NestNode extends GraphNode {
  label: string;
  cachedResult: CubeValue | SolError | null = null;
  stringLiterals: Record<string, string> = { nestedName: "items" };
  width = 200; height = 175;

  constructor(init?: { label?: string }) {
    super("Nest");
    this.label = init?.label ?? "Nest";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("keys", strListIn("Keys"));
    this.addInput("nestedName", strIn("Nested name"));
    this.addOutput("cube", cubeOut("Cube"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { cube: CubeValue | SolError | null } {
    return nodeOnCore(this, inputs) as { cube: CubeValue | SolError | null };
  }
}

export class UnnestNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    frame: "A parent row with an empty or missing nested table disappears from the output.",
  };

  label: string;
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "" };
  width = 190; height = 150;

  constructor(init?: { label?: string }) {
    super("Unnest");
    this.label = init?.label ?? "Unnest";
    this.addInput("cube", cubeIn("Cube"));
    this.addInput("column", strIn("Nested column"));
    this.addOutput("frame", staticTrueAnyOut("Flat"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | CubeValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | CubeValue | SolError | null };
  }
}

// ─── APPEND ────────────────────────────────────────────────────────────────────

export class AppendNode extends GraphNode {
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  nextInputId = 0;
  width = 190; height = 215;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("Append");
    this.label = init?.label ?? "Append";
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("f"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 2; i++) this.addValueInput();
    this.addOutput("frame", frameOut("Stacked"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, frameIn("Frame"));
    const n = parseInt(key.replace(/^f/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  /** Insertion order is stack order. */
  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("f"));
  }

  addValueInput(): string {
    const key = `f${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
  }

  /** One unresolvable wired row could add unseen columns, so it makes the whole stack unknown. */
  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const shapes: Shape[] = [];
    for (const k of this.valueInputKeys()) {
      if (!ctx.wired(k)) continue;
      const s = ctx.inputShape(k);
      if (!s) return null;
      shapes.push(s);
    }
    if (shapes.length === 0) return null;
    return shapes.length === 1 ? shapes[0] : shapeOfAppend(shapes);
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── BIND COLUMNS ──────────────────────────────────────────────────────────────

export class BindColumnsNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    frame: "Every column of every frame, left to right; a repeated name gets a 2, 3… suffix; a shorter frame pads down with blanks.",
  };
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  nextInputId = 0;
  width = 190; height = 215;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("BindColumns");
    this.label = init?.label ?? "Bind Columns";
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("f"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 2; i++) this.addValueInput();
    this.addOutput("frame", frameOut("Bound"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, frameIn("Frame"));
    const n = parseInt(key.replace(/^f/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  /** Insertion order is left-to-right order. */
  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("f"));
  }

  addValueInput(): string {
    const key = `f${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const shapes: Shape[] = [];
    for (const k of this.valueInputKeys()) {
      if (!ctx.wired(k)) continue;
      const s = ctx.inputShape(k);
      if (!s) return null;
      shapes.push(s);
    }
    if (shapes.length === 0) return null;
    if (shapes.length === 1) return shapes[0];
    const bound = bindSchema(shapes.map(emptyFrameOf));
    return bound ? shapeOfFrameValue(bound) : null;
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── RENAME COLUMNS ────────────────────────────────────────────────────────────

export class RenameNode extends GraphNode {
  label: string;
  stringLiterals: Record<string, string> = {};
  cachedResult: FrameValue | SolError | null = null;
  width = 190; height = 175;

  constructor(init?: { label?: string }) {
    super("Rename");
    this.label = init?.label ?? "Rename";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("from", strListIn("From"));
    this.addInput("to", strListIn("To"));
    this.addOutput("frame", frameOut("Frame"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("from") || ctx.wired("to")) return null;
    const from = csvList(this.stringLiterals.from);
    const to = csvList(this.stringLiterals.to);
    const map: Record<string, string> = {};
    for (let i = 0; i < Math.min(from.length, to.length); i++) if (from[i] && to[i]) map[from[i]] = to[i];
    return Object.keys(map).length ? shapeOf({ kind: "rename", map }, input) : input;
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── SPLIT COLUMN / ADD INDEX (Power Query column ops) ──────────────────────────

export class SplitColumnNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    into: "Names for the split-out columns.",
  };
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "", delimiter: ",", into: "" };
  width = 200; height = 215;

  constructor(init?: { label?: string }) {
    super("SplitColumn");
    this.label = init?.label ?? "Split Column";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("column", strIn("Column"));
    this.addInput("delimiter", strIn("Delimiter"));
    this.addInput("into", strListIn("Into"));
    this.addOutput("frame", frameOut("Frame"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("column")) return null;
    const column = (this.stringLiterals.column ?? "").trim();
    if (!column) return input;
    if (ctx.wired("delimiter")) return null;
    return shapeOfSplitColumn(input, column, this.stringLiterals.delimiter ?? "");
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

export class AddIndexNode extends GraphNode {
  static inputRoles = { start: setting(1) };
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  literals: Record<string, number> = { start: 1 };
  stringLiterals: Record<string, string> = { name: "Index" };
  width = 190; height = 175;

  constructor(init?: { label?: string }) {
    super("AddIndex");
    this.label = init?.label ?? "Add Index";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("start", numIn("Start"));
    this.addInput("name", strIn("Name"));
    this.addOutput("frame", frameOut("Frame"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("name")) return null;
    return shapeOfAddIndex(input, this.stringLiterals.name || "Index");
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

export type FillDir = "down" | "up";

export class FillBlanksNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    columns: "Leave blank to fill every column.",
  };
  label: string;
  dir: FillDir;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { columns: "" };
  width = 190; height = 160;

  constructor(init?: { label?: string; dir?: FillDir }) {
    super("FillBlanks");
    this.label = init?.label ?? "Fill Down";
    this.dir = init?.dir ?? "down";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("columns", strListIn("Columns"));
    this.addOutput("frame", frameOut("Frame"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("columns")) return null;
    const columns = csvList(this.stringLiterals.columns).map((c) => c.trim()).filter(Boolean);
    return shapeOf({ kind: "fillBlanks", columns, dir: this.dir }, input);
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

export type ReplaceMode = "cell" | "substring";

export class ReplaceValuesNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    column: "Leave blank to replace across every column.",
  };
  label: string;
  mode: ReplaceMode;
  /** Find's Aa: text matches case exactly; off, it ignores case as Filter's does. */
  matchCase: boolean;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "", find: "", replace: "" };
  textLiterals = true;
  width = 200; height = 205;

  constructor(init?: { label?: string; mode?: ReplaceMode; matchCase?: boolean }) {
    super("ReplaceValues");
    this.label = init?.label ?? "Replace Values";
    this.mode = init?.mode ?? "cell";
    this.matchCase = init?.matchCase ?? false;
    this.addInput("frame", frameIn("Frame"));
    this.addInput("column", strIn("Column"));
    this.addInput("find", anyIn("Find"));
    this.addInput("replace", anyIn("Replace"));
    this.addOutput("frame", frameOut("Frame"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("column")) return null;
    return shapeOf({
      kind: "replaceValues", column: this.stringLiterals.column ?? "",
      find: this.stringLiterals.find ?? "", replaceWith: this.stringLiterals.replace ?? "", mode: this.mode, matchCase: this.matchCase,
    }, input);
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

export class MergeColumnsNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    name: "The merged column's name. Defaults to Merged.",
  };
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { columns: "", separator: "", name: "" };
  width = 200; height = 190;

  constructor(init?: { label?: string }) {
    super("MergeColumns");
    this.label = init?.label ?? "Merge Columns";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("columns", strListIn("Columns"));
    this.addInput("separator", strIn("Separator"));
    this.addInput("name", strIn("Name"));
    this.addOutput("frame", frameOut("Frame"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("columns") || ctx.wired("name")) return null;
    const columns = csvList(this.stringLiterals.columns).map((c) => c.trim()).filter(Boolean);
    if (columns.length < 2) return input;
    return shapeOf({ kind: "mergeColumns", columns, separator: "", name: this.stringLiterals.name ?? "" }, input);
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

export type HeaderOp = "promote" | "demote";

export const HEADER_OP_META: Record<HeaderOp, { label: string; description: string }> = {
  promote: { label: "Promote first row", description: "The first row becomes the column names. Power Query: `Use First Row as Headers`." },
  demote:  { label: "Demote headers", description: "Column names drop into a first row of text. Columns auto-name `Col1`, `Col2`…" },
};

export class HeadersNode extends GraphNode {
  label: string;
  action: HeaderOp;
  cachedResult: FrameValue | SolError | null = null;
  width = 200; height = 140;

  constructor(init?: { label?: string; action?: HeaderOp }) {
    super("Headers");
    this.label = init?.label ?? "Headers";
    this.action = init?.action ?? "promote";
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("frame", frameOut("Frame"));
  }

  /** Promote takes its names from the first row, which is data, so only Demote has a static shape. */
  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || this.action === "promote") return null;
    return shapeOnCore("demoteHeaders", [input]);
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

export type BlankRowMode = "all" | "any";

export const BLANK_ROW_OP_META: Record<BlankRowMode, { label: string; description: string }> = {
  all: { label: "All cells blank", description: "Drop only fully-blank rows, the spacers." },
  any: { label: "Any cell blank",  description: "Keep only complete rows." },
};

export class DropBlankRowsNode extends GraphNode {
  label: string;
  mode: BlankRowMode;
  cachedResult: FrameValue | SolError | null = null;
  width = 190; height = 140;

  constructor(init?: { label?: string; mode?: BlankRowMode }) {
    super("DropBlankRows");
    this.label = init?.label ?? "Drop Blank Rows";
    this.mode = init?.mode ?? "all";
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("frame", frameOut("Frame"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    return input && shapeOf({ kind: "dropBlankRows", mode: this.mode }, input);
  }


  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── DECISION MATRIX ───────────────────────────────────────────────────────────

export type DecisionDetail = "summary" | "breakdown";

export class DecisionMatrixNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    frame: "Rows are options. Number and logical columns are the criteria, and the first text column names the options. Date columns are skipped. A Cube's nested tables are further choices under each row, ranked with the same Weights; each row counts the best one inside as a criterion named after the nested column.",
    weights: "A row per criterion: name, Weight (negative when lower is better), optional Norm (Raw, ÷Max, Range, Rank), and optional At least and At most, deal-breakers that rule an option out before weighing. A missing criterion weighs 1 at the default Norm.",
  };

  label: string;
  normalize: DecisionNormalize;
  detail: DecisionDetail;
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  width = 240; height = 205;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Option", type: "string", cells: ["Vendor A", "Vendor B", "Vendor C"] },
      { name: "Cost", type: "number", cells: [7, 5, 8] },
      { name: "Speed", type: "number", cells: [9, 6, 4] },
      { name: "Risk", type: "number", cells: [4, 8, 6] },
    ] },
    weights: { columns: [
      { name: "Criterion", type: "string", cells: ["Cost", "Speed", "Risk"] },
      { name: "Weight", type: "number", cells: [-1, 2, -1] },
      { name: "Norm", type: "string", cells: ["Rank", "÷Max", "Rank"] },
    ] },
  };

  constructor(init?: { label?: string; normalize?: DecisionNormalize; detail?: DecisionDetail }) {
    super("DecisionMatrix");
    this.label = init?.label ?? "Decision Matrix";
    this.normalize = init?.normalize ?? "max";
    this.detail = init?.detail ?? "summary";
    this.addInput("frame", cubeAdoptIn("Scores / Cube"));
    this.addInput("weights", frameIn("Weights"));
    this.addOutput("frame", tableAdoptOut("Ranking"));
  }
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);

  // A Cube in ranks its nested choices too, so a Cube comes out.
  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    const shape = input && sampleShapeOnCore("decisionMatrix", [input], [this.normalize, this.detail === "breakdown"]);
    // Ruled out by and Filled in come and go with the data, so the shape is never the whole story.
    return shape && { ...shape, dynamic: true };
  }


  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | CubeValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | CubeValue | SolError | null };
  }
}

// ─── DECISION SENSITIVITY ───────────────────────────────────────────────────────

export type SensitivityMode = "scenarios" | "flips";

export class DecisionSensitivityNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    scores: "The options frame a Decision Matrix takes: rows are options, number columns criteria.",
    scenarios: "Scenarios: the Decision Matrix weights frame widened, one row per Criterion and a number column per scenario (its header names it) carrying that scenario's weight; an optional Norm column and At least / At most apply across every scenario, and a criterion a scenario omits weighs 1. Flip points: the Decision Matrix's own Weights table.",
    cube: "Scenarios: a row per scenario with its Winner, Margin and full Ranking. Flip points: a row per criterion with the weight at which another option would win if the criterion mattered less, and if it mattered more, and which one; with no such weight, the winner stays and is named.",
  };

  label: string;
  normalize: DecisionNormalize;
  mode: SensitivityMode;
  cachedResult: CubeValue | FrameValue | SolError | null = null;
  width = 220; height = 240;

  static frameHints: Record<string, FrameHint> = {
    scores: DecisionMatrixNode.frameHints.frame,
    scenarios: { columns: [
      { name: "Criterion", type: "string", cells: ["Cost", "Speed", "Risk"] },
      { name: "Balanced", type: "number", cells: [-1, 1, -1] },
      { name: "Cost-first", type: "number", cells: [-3, 1, -1] },
      { name: "Speed-first", type: "number", cells: [-1, 3, -1] },
    ] },
  };

  // The mode swaps the output between a Cube of scenarios and a Frame of flip points.
  static outputFor(mode: SensitivityMode) { return mode === "flips" ? frameOut("Flip points") : cubeOut("By scenario"); }
  static inputLabel(mode: SensitivityMode) { return mode === "flips" ? "Weights" : "Scenarios"; }

  constructor(init?: { label?: string; normalize?: DecisionNormalize; mode?: SensitivityMode }) {
    super("DecisionSensitivity");
    this.label = init?.label ?? "Sensitivity";
    this.normalize = init?.normalize ?? "max";
    this.mode = init?.mode === "flips" ? "flips" : "scenarios";
    this.addInput("scores", frameIn("Scores"));
    this.addInput("scenarios", frameIn(DecisionSensitivityNode.inputLabel(this.mode)));
    this.addOutput("cube", DecisionSensitivityNode.outputFor(this.mode));
  }

  setMode(next: SensitivityMode): { outputChanged: boolean } {
    if (next === this.mode) return { outputChanged: false };
    this.mode = next;
    const spec = DecisionSensitivityNode.outputFor(next);
    this.outputs.cube!.socket = spec.socket;
    this.outputs.cube!.label = spec.label;
    this.inputs.scenarios!.label = DecisionSensitivityNode.inputLabel(next);
    return { outputChanged: true };
  }

  frameShape(_outKey: string, _ctx: FrameShapeContext): Shape | null {
    return this.mode === "flips" ? sampleShapeOnCore("flipPoints", [SAMPLE_OPTIONS], [this.normalize]) : null;
  }


  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { cube: CubeValue | FrameValue | SolError | null };
  }
}

// ─── CHOICE LADDER ──────────────────────────────────────────────────────────────

export class ChoiceLadderNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    frame: "The Decision Matrix's options frame plus a cost column per limit, named as in Limits. Optional Requires and Excludes text columns list other options by name; optional Must and Never logical columns force an option in or out; options sharing a One of value exclude each other.",
    limits: "A row per resource naming an Options column (a logical one counts TRUE as 1). At most caps it and At least sets a floor, like at least two vegetarian; with neither it is a rough cost, like political capital, that orders the ladder by value for what it costs.",
    close: "Two options whose places differ by no more than this share of the larger fork the ladder. 0.05 or 5 both read as 5%.",
    chart: "The ladder: value flows down and each rung takes what it serves. Click a card at a fork to take it.",
  };

  label: string;
  normalize: DecisionNormalize;
  /** The options taken at forks, by name in the order taken. */
  choices: string[];
  literals: Record<string, number> = { close: 0.05 };
  cachedResult: FrameValue | SolError | null = null;
  cachedChart: ChartValue | SolError | null = null;
  width = 240; height = 230;

  static frameHints: Record<string, FrameHint> = {
    frame: { columns: [
      { name: "Restaurant", type: "string", cells: ["Kato", "Lune", "Taqueria Sol"] },
      { name: "Food", type: "number", cells: [9, 8, 8] },
      { name: "Vibe", type: "number", cells: [7, 9, 5] },
      { name: "Dollars", type: "number", cells: [160, 75, 18] },
      { name: "Meals", type: "number", cells: [1, 1, 1] },
      { name: "Hours", type: "number", cells: [2, 2, 1] },
    ] },
    weights: DecisionMatrixNode.frameHints.weights,
    limits: { columns: [
      { name: "Resource", type: "string", cells: ["Dollars", "Meals", "Hours"] },
      { name: "At most", type: "number", cells: [450, 6, 10] },
    ] },
  };

  constructor(init?: { label?: string; normalize?: DecisionNormalize; choices?: string[] }) {
    super("ChoiceLadder");
    this.label = init?.label ?? "Choice Ladder";
    this.normalize = init?.normalize ?? "max";
    this.choices = Array.isArray(init?.choices) ? init.choices.filter((c) => typeof c === "string") : [];
    this.addInput("frame", frameIn("Options"));
    this.addInput("weights", frameIn("Weights"));
    this.addInput("limits", frameIn("Limits"));
    this.addInput("close", numIn("Close within"));
    this.addOutput("frame", frameOut("Plan"));
    this.addOutput("chart", chartOut("Ladder"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    const shape = input && sampleShapeOnCore("choiceLadder", [input], [this.normalize, 0, [], false, false]);
    // The cost columns follow, one per Limits row.
    return shape && { ...shape, dynamic: true };
  }


  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | SolError | null; chart: ChartValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null; chart: ChartValue | SolError | null };
  }
}

// ─── BUDGET ALLOCATOR ───────────────────────────────────────────────────────────
export const ALLOCATE_MODE_META = {
  budget:          { label: "Fit budget",       description: "Spend a fixed budget across the categories in proportion to their weights, held inside each range." },
  minTarget:       { label: "Min for target",   description: "The least spend that reaches a weighted-value target, buying the most-valued categories first." },
  minProportional: { label: "Min proportional", description: "The least spend that keeps each category in proportion to its weight while covering its floor." },
} satisfies Record<AllocateMode, { label: string; description: string }>;

export class AllocatorNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    categories: "Rows are categories: the first text column names them, min and max columns set the range, Weight or Value ranks them. Without one, equal weights.",
    amount: "The budget to spend under Fit budget, or the value target to reach under Min for target. Ignored by Min proportional.",
  };

  label: string;
  mode: AllocateMode;
  literals: Record<string, number> = { amount: 60000 };
  cachedResult: FrameValue | SolError | null = null;
  width = 240; height = 191;

  static frameHints: Record<string, FrameHint> = {
    categories: { columns: [
      { name: "Category", type: "string", cells: ["Car", "Housing", "Other"] },
      { name: "Min", type: "number", cells: [20000, 15000, 10000] },
      { name: "Max", type: "number", cells: [50000, 45000, 40000] },
      { name: "Weight", type: "number", cells: [1, 2, 1] },
    ] },
  };

  constructor(init?: { label?: string; mode?: AllocateMode }) {
    super("Allocator");
    this.label = init?.label ?? "Allocator";
    this.mode = init?.mode ?? "budget";
    this.addInput("categories", frameIn("Categories"));
    this.addInput("amount", numIn("Budget / Target"));
    this.addOutput("frame", frameOut("Allocation"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("categories");
    return input ? shapeOnCore("allocateFrame", [input], [this.mode, 0]) : null;
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

// ─── PAYOFF PLANNER ─────────────────────────────────────────────────────────
export type PayoffOrder = "avalanche" | "snowball";
export type PayoffView = "summary" | "schedule";

export const PAYOFF_ORDER_META = {
  avalanche: { label: "Avalanche", description: "Extra goes to the highest APR first: the least interest overall." },
  snowball:  { label: "Snowball",  description: "Extra goes to the smallest balance first: the quickest first win." },
} satisfies Record<PayoffOrder, { label: string; description: string }>;

export class PayoffPlannerNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    debts: "Rows are debts: a name, Balance, APR as 0.24 or 24, and Min, the minimum monthly payment. Balance's currency rides onto the result.",
    extra: "The extra paid every month on top of the minimums; it moves to the next debt as each one clears.",
    start: "The month the plan starts. Unwired, this month.",
    frame: "Summary: Debt · Months · Interest · Payoff date. Schedule: Month · a balance column per debt.",
  };

  label: string;
  order: PayoffOrder;
  mode: PayoffView;
  literals: Record<string, number> = { extra: 0 };
  cachedResult: FrameValue | SolError | null = null;
  width = 240; height = 220;

  static frameHints: Record<string, FrameHint> = {
    debts: { columns: [
      { name: "Debt", type: "string", cells: ["Card", "Car", "Store"] },
      { name: "Balance", type: "number", cells: [3000, 8000, 500] },
      { name: "APR", type: "number", cells: [0.24, 0.06, 0.18] },
      { name: "Min", type: "number", cells: [90, 250, 25] },
    ] },
  };

  constructor(init?: { label?: string; order?: PayoffOrder; mode?: PayoffView }) {
    super("PayoffPlanner");
    this.label = init?.label ?? "Payoff Planner";
    this.order = init?.order === "snowball" ? "snowball" : "avalanche";
    this.mode = init?.mode === "schedule" ? "schedule" : "summary";
    this.addInput("debts", frameIn("Debts"));
    this.addInput("extra", numIn("Extra per month"));
    this.addInput("start", dateIn("Start"));
    this.addOutput("frame", frameOut("Plan"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("debts");
    // Schedule has one column per debt row, so no static shape.
    return input && this.mode === "summary" ? sampleShapeOnCore("payoffFrame", [input], [0, this.order, "summary", null]) : null;
  }


  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

// ─── GROUP COST SETTLE ──────────────────────────────────────────────────────
export type SettleSplit = "equal" | "weighted";
export type SettleMode = "totals" | "transactions";

export class SettleNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    in: "Totals: a row per person, Paid and optional Share (blank is 1). Transactions: a row per expense, Amount, Paid by and For; blank For is everyone.",
    transfers: "The settle-up, and the node's main output: who pays whom in the fewest transfers, From · To · Amount. Amounts carry the Amount column's currency.",
    net: "Each person's true cost: Paid, Owes (still due to the group), Owed (coming back from it) and Net, their fair share.",
  };

  label: string;
  mode: SettleMode;
  split: SettleSplit;
  unitAware = true;
  cachedResult: FrameValue | SolError | null = null;
  cachedNet: FrameValue | SolError | null = null;
  width = 240; height = 220;

  static frameHints: Record<string, FrameHint> = {
    in: { columns: [
      { name: "Person", type: "string", cells: ["Ada", "Bo", "Cy"] },
      { name: "Paid", type: "number", cells: [300, 100, 0] },
      { name: "Share", type: "number", cells: [1, 1, 2] },
    ] },
  };

  constructor(init?: { label?: string; mode?: SettleMode; split?: SettleSplit }) {
    super("Settle");
    this.label = init?.label ?? "Group Cost Settle";
    this.mode = init?.mode === "transactions" ? "transactions" : "totals";
    this.split = init?.split === "weighted" ? "weighted" : "equal";
    this.addInput("in", this.inputPort());
    this.addOutput("transfers", frameOut("Transfers"));
    this.addOutput("net", frameOut("Net"));
  }

  private inputPort() {
    return this.mode === "transactions" ? cubeIn("Ledger") : frameIn("People");
  }

  setMode(next: SettleMode): void {
    if (next === this.mode) return;
    this.mode = next;
    const input = this.inputs.in;
    if (!input) return;
    const port = this.inputPort();
    input.socket = port.socket;
    input.label = port.label;
  }

  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = this.mode === "totals" ? ctx.inputShape("in") : null;
    const both = sampleShapeOnCore("settleFrame", [input ?? SAMPLE_PEOPLE], [this.split]);
    if (!both) return null;
    // The core answers the transfers and the net table side by side, the transfers' three columns first.
    return { columns: outKey === "transfers" ? both.columns.slice(0, 3) : both.columns.slice(3) };
  }


  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { transfers: FrameValue | SolError | null; net: FrameValue | SolError | null };
  }
}

// ─── RECONCILE ───────────────────────────────────────────────────────────────

export class ReconcileNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    key: "Duplicate keys pair up in order. A row whose key is blank or an error cannot match and comes out as skipped.",
  };

  label: string;
  cachedResult: FrameValue | SolError | null = null;
  cachedSummary = "";
  stringLiterals: Record<string, string> = { key: "", priceColumn: "", qtyColumn: "" };
  width = 240; height = 280;

  constructor(init?: { label?: string }) {
    super("Reconcile");
    this.label = init?.label ?? "Reconcile";
    this.addInput("left", frameIn("Before"));
    this.addInput("right", frameIn("After"));
    this.addInput("key", strIn("Key column"));
    this.addInput("priceColumn", strIn("Price column"));
    this.addInput("qtyColumn", strIn("Qty column"));
    this.addOutput("frame", frameOut("Reconciliation"));
    this.addOutput("summary", strOut("Summary"));
  }

  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null {
    if (outKey !== "frame") return null;
    const left = ctx.inputShape("left");
    const right = ctx.inputShape("right");
    const key = (this.stringLiterals.key ?? "").trim();
    if (!left || !right || !key || ctx.wired("key")) return null;
    return shapeOnCore("reconcileFrames", [left, right], [key, key]);
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null; summary: string | SolError };
  }
}

// ─── BUILD FRAME ───────────────────────────────────────────────────────────────

export class BuildFrameNode extends GraphNode {
  label: string;
  stringLiterals: Record<string, string> = {};
  cachedResult: FrameValue | null = null;
  width = 200; height = 175;

  constructor(init?: { label?: string }) {
    super("BuildFrame");
    this.label = init?.label ?? "Build Frame";
    this.addInput("matrix", adoptiveTableIn("Matrix"));
    this.addInput("headers", strListIn("Headers"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | null };
  }
}

// ─── FRAME FROM LISTS ─────────────────────────────────────────────────────────

export class FrameFromListsNode extends GraphNode {
  label: string;
  cachedResult: FrameValue | null = null;
  stringLiterals: Record<string, string> = {};
  literals: Record<string, number> = {};
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["Name", "Values"];
  width = 220; height = 240;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("FrameFromLists");
    this.label = init?.label ?? "Frame from Lists";
    const ids = pairIdsFromKeys(init?.valueKeys, "name");
    if (ids.length) {
      for (const id of ids) this.addPairWithId(id);
    } else {
      for (let i = 0; i < 2; i++) this.addValuePair();
    }
    this.addOutput("frame", frameOut("Frame"));
  }

  private addPairWithId(id: number): void {
    this.addInput(`name${id}`, strIn(`Name ${id + 1}`));
    this.addInput(`vals${id}`, adoptiveListIn(`Column ${id + 1}`));
    this.nextPairId = Math.max(this.nextPairId, id + 1);
  }

  valuePairKeys(): Array<[string, string]> {
    return Object.keys(this.inputs)
      .filter((k) => k.startsWith("name"))
      .map((k) => { const id = k.slice(4); return [`name${id}`, `vals${id}`] as [string, string]; });
  }

  addValuePair(): void {
    this.addPairWithId(this.nextPairId);
  }

  removeValuePair(nameKey: string): void {
    const id = nameKey.slice(4);
    this.removeInput(`name${id}`);
    this.removeInput(`vals${id}`);
    delete this.stringLiterals[`name${id}`];
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const cols: ShapeColumn[] = [];
    for (const [nameKey, valsKey] of this.valuePairKeys()) {
      if (!ctx.wired(valsKey)) continue;
      if (ctx.wired(nameKey)) return null;
      const sock = this.inputs[valsKey]?.socket;
      const known = colTypeForSocket(sock instanceof SolenoidSocket ? sock.dataType : undefined);
      if (!known) return null;
      cols.push({ name: (this.stringLiterals[nameKey] ?? "").trim(), type: known });
    }
    if (cols.length === 0) return null;
    const names = makeHeaders(cols.map((c) => c.name), cols.length);
    return { columns: cols.map((c, i) => ({ name: names[i], type: c.type })) };
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | null };
  }
}

// ─── SPLIT FRAME ───────────────────────────────────────────────────────────────

export type SplitColType = "all" | FrameColType;

export function splitMatrixOutput(colType: SplitColType) {
  return colType === "string" ? strTableOut("Matrix")
    : colType === "date" ? dateTableOut("Matrix")
    : colType === "logical" ? logicalTableOut("Matrix")
    : tableOut("Matrix");
}

export class SplitFrameNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    matrix: "Under All, one text or date column blanks the whole matrix; pick Text or Date to split those columns. Booleans ride as 1 and 0.",
  };

  label: string;
  colType: SplitColType;
  cachedMatrix: (number | string)[][] | null = null;
  cachedHeaders: string[] | null = null;
  // True when All keeps a text or date column, so the Matrix output is null by design.
  cachedMixed = false;
  width = 230; height = 200;

  constructor(init?: { label?: string; colType?: SplitColType }) {
    super("SplitFrame");
    this.label = init?.label ?? "Split Frame";
    this.colType = init?.colType ?? "all";
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("matrix", splitMatrixOutput(this.colType));
    this.addOutput("headers", strListOut("Headers"));
  }

  setColType(next: SplitColType): void {
    this.colType = next;
    const out = this.outputs.matrix;
    if (out) out.socket = splitMatrixOutput(next).socket;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { matrix: (number | string)[][] | null; headers: string[] | null };
  }
}

// ─── GET COLUMN ────────────────────────────────────────────────────────────────

export type GetColumnReadAs = "auto" | "number" | "text" | "date" | "logical";

/** Auto's list adopts the picked column's family (`passthrough`, else the values it carried); the others declare their own. */
function getColumnOutput(readAs: GetColumnReadAs) {
  return readAs === "text" ? strListOut("Values")
    : readAs === "date" ? dateListOut("Values")
    : readAs === "logical" ? logicalListOut("Values")
    : readAs === "auto" ? adoptiveListOut("Values")
    : listOut("Values");
}

type GetColumnValues =
  | (number | UnitCell | null | SolError)[]
  | string[]
  | (boolean | null | SolError)[]
  | SolError
  | null;

export class GetColumnNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    values: "Number and Date reads coerce rather than filter: a text cell parses or becomes NaN, a boolean becomes 1 or 0, and blanks stay blank.",
  };

  label: string;
  readAs: GetColumnReadAs;
  cachedResult: (number | UnitCell | null | SolError)[] | string[] | (boolean | null | SolError)[] | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  stringLiterals: Record<string, string> = { name: "" };
  width = 200; height = 205;

  constructor(init?: { label?: string; readAs?: GetColumnReadAs }) {
    super("GetColumn");
    this.label = init?.label ?? "Get Column";
    // Auto reads a column as its own type, so a date column comes out as dates ([[C137]] datesNeverSerials).
    this.readAs = init?.readAs ?? "auto";
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("name", strIn("Column"));
    this.addOutput("values", getColumnOutput(this.readAs));
  }

  /** On Auto, the output takes the named column's family where the shape is known, else the values it carried. */
  passthrough(): PassthroughSpec[] {
    if (this.readAs !== "auto") return [];
    return [{
      output: "values",
      inputs: ["frame"],
      combine: "single",
      project: (ctx) => {
        const name = ctx.wired("name") ? "" : (this.stringLiterals.name ?? "").trim();
        const shape = name ? ctx.shapeOf("frame") : null;
        const col = shape && !shape.dynamic ? shape.columns.find((c) => c.name === name) : undefined;
        const fam: SocketDataType = col ? comboOfFamily(col.type) ?? "trueany" : "trueany";
        return { frame: fam, cube: "trueany", tables: "trueany" };
      },
    }];
  }

  setReadAs(next: GetColumnReadAs): void {
    this.readAs = next;
    const out = this.outputs.values;
    if (out) out.socket = getColumnOutput(next).socket;
  }

  columnPickers(): ColumnPickerSpec[] { return [{ key: "name", frameInput: "frame" }]; }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { values: GetColumnValues };
  }
}

// ─── ADD COLUMN ────────────────────────────────────────────────────────────────

export type AddColumnAddAs = "number" | "text" | "date" | "logical";

function colTypeForAddAs(addAs: AddColumnAddAs): FrameColType {
  return addAs === "text" ? "string" : addAs;
}

function addColumnInput(addAs: AddColumnAddAs) {
  return addAs === "text" ? strListIn("Values")
    : addAs === "date" ? dateListIn("Values")
    : addAs === "logical" ? logicalListIn("Values")
    : listIn("Values");
}

export class AddColumnNode extends GraphNode {
  label: string;
  addAs: AddColumnAddAs;
  cachedResult: FrameValue | CubeValue | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  stringLiterals: Record<string, string> = { name: "" };
  width = 200; height = 235;

  constructor(init?: { label?: string; addAs?: AddColumnAddAs }) {
    super("AddColumn");
    this.label = init?.label ?? "Add Column";
    this.addAs = init?.addAs ?? "number";
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("name", strIn("Name"));
    this.addInput("values", addColumnInput(this.addAs));
    this.addOutput("frame", tableAdoptOut("Frame"));
  }

  setAddAs(next: AddColumnAddAs): void {
    this.addAs = next;
    const inp = this.inputs.values;
    if (inp) inp.socket = addColumnInput(next).socket;
  }

  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame"); // null for a cube, whose shape rides the passthrough
    if (!input || ctx.wired("name")) return null;
    const name = (this.stringLiterals.name ?? "").trim() || "Col";
    return shapeOfFrameValue(addColumn(emptyFrameOf(input), name, [], colTypeForAddAs(this.addAs)));
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | CubeValue | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | CubeValue | null };
  }
}

// ─── COMPUTED COLUMN ───────────────────────────────────────────────────────────

export type ComputedColumnAs = "auto" | AddColumnAddAs;

const COMPUTED_RESERVED = ["frame", "name", "fn", "after"];


export class ComputedColumnNode extends GraphNode {
  unitAware = true;
  static socketDocs: Record<string, string> = {
    after: "Empty appends the new column at the end. A column name inserts it immediately after that column. A replaced column keeps its place.",
  };

  label: string;
  expr: string;
  addAs: ComputedColumnAs;
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  stringLiterals: Record<string, string> = { name: "computed", after: "" };
  literals: Record<string, number> = {};
  sideVars: string[] = [];
  bindings: Record<string, string> = {};
  sourceColumns: string[] = [];
  defVars: string[] = [];
  width = 235; height = 290;

  constructor(init?: { label?: string; expr?: string; addAs?: ComputedColumnAs; literals?: Record<string, number>; bindings?: Record<string, string>; sideVars?: string[] }) {
    super("ComputedColumn");
    this.label = init?.label ?? "Computed Column";
    this.expr = init?.expr ?? "";
    this.addAs = init?.addAs === "number" || init?.addAs === "text" || init?.addAs === "date" || init?.addAs === "logical" ? init.addAs : "auto";
    if (init?.literals) this.literals = { ...init.literals };
    if (init?.bindings) this.bindings = { ...init.bindings };
    if (Array.isArray(init?.sideVars)) {
      this.sideVars = init.sideVars.filter((v) => typeof v === "string");
      for (const v of this.sideVars) this.addInput(v, anyDataIn(v));
    }
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("name", strIn("Name"));
    this.addInput("after", strIn("After"));
    this.addInput("fn", lambdaIn("λ"));
    this.addOutput("frame", tableAdoptOut("Frame"));
  }

  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  /** The side inputs grown to the body's `sideVars` (`nodeOnCore`'s `coreWatch`); the socket changes wait for a
   *  microtask, and cables on a removed socket are pruned first. */
  static coreWatch = "sideVars";
  coreWatched(): void {
    const needed = this.sideVars;
    const grown = Object.keys(this.inputs).filter((k) => !COMPUTED_RESERVED.includes(k));
    const added = needed.filter((v) => !grown.includes(v));
    const removed = grown.filter((v) => !needed.includes(v));
    if (added.length === 0 && removed.length === 0) return;
    queueMicrotask(() => {
      void (async () => {
        for (const v of added) if (!this.inputs[v]) this.addInput(v, anyDataIn(v));
        await dropInputCables(this.id, removed);
        for (const v of removed) if (this.inputs[v]) this.removeInput(v);
        await getOwningView(this.id)?.rerenderNode(this.id);
      })();
    });
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input) return null;
    if (!ctx.wired("fn") && !this.expr.trim()) return input;
    if (this.addAs === "auto" || ctx.wired("name") || ctx.wired("after")) return null;
    const name = (this.stringLiterals.name ?? "").trim() || "computed";
    const after = (this.stringLiterals.after ?? "").trim();
    const result = addColumn(emptyFrameOf(input), name, [], colTypeForAddAs(this.addAs));
    const replacing = result.columns.length === input.columns.length;
    if (!after || replacing) return shapeOfFrameValue(result);
    const anchorIdx = result.columns.findIndex((c) => c.name === after);
    if (anchorIdx < 0) throw solError("#REF!", `No column "${after}" to place after`);
    const cols = [...result.columns];
    cols.splice(anchorIdx + 1, 0, cols.pop()!);
    return shapeOfFrameValue({ __frame: true, columns: cols });
  }

  /** The bindings cross whole: a save keeps only the ones the formula's variables name, and `@x` is not one. The
   *  recalculation lets a kept answer stand only until F9 or midnight, for a TODAY or NOW in the formula or a wired
   *  LAMBDA (`KEEPS_ANSWER`). */
  static coreFields = ["bindings", "recalcGen"] as const;
  get recalcGen(): number {
    return getRecalcGen();
  }

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}

// ─── GET ROW ────────────────────────────────────────────────────────────────────

export class GetRowNode extends GraphNode {
  static inputRoles = { index: required };
  label: string;
  cachedResult: FrameValue | CubeValue | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  literals: Record<string, number> = { index: 1 };
  width = 200; height = 175;

  constructor(init?: { label?: string; index?: number }) {
    super("GetRow");
    this.label = init?.label ?? "Get Row";
    if (init?.index !== undefined) this.literals.index = init.index;
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("index", numIn("Row"));
    this.addOutput("frame", tableAdoptOut("Row"));
  }

  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | CubeValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | CubeValue | SolError | null };
  }
}

// ─── XLOOKUP ───────────────────────────────────────────────────────────────────

export type LookupDirection = "rows" | "columns";

/** Rows: the lookup searches a column and returns a row's cell. Columns: it searches a row and returns a column. */
export class XLookupNode extends GraphNode {
  static fieldPlaceholders: Record<string, string> = { returnColumn: "all", inRow: "names", returnRow: "all" };
  static socketDocs: Record<string, string> = {
    lookup: "Matching follows the In column's type: text ignores case, and a number or date column parses the lookup text. =, ≤ and ≥ take the equal or closest key, < and > the closest strictly past it; contains, starts with and the rest take the first row that passes, as Filter's tests do. Is blank and not blank ignore it.",
    returnColumn: "Blank returns the whole matched row.",
    inRow: "The row searched, counting from 1. Blank searches the column names.",
    returnRow: "The row whose cell comes back from the matched column. Blank returns the whole column.",
  };

  label: string;
  matchMode: LookupMatchMode;
  searchMode: LookupSearchMode;
  cachedResult: CubeCell | null = null;
  direction: LookupDirection;
  stringLiterals: Record<string, string> = { lookup: "", inColumn: "", returnColumn: "", ifNotFound: "" };
  literals: Record<string, number> = {};
  // Skip rank widening so a scalar or bare list reaches the shape guard in data() instead of becoming a one-row cube.
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  width = 200; height = 350;

  constructor(init?: { label?: string; matchMode?: LookupMatchMode; searchMode?: LookupSearchMode; direction?: LookupDirection }) {
    super("XLookup");
    this.label = init?.label ?? "XLOOKUP";
    this.matchMode = init?.matchMode ?? "eq";
    this.searchMode = init?.searchMode ?? "first";
    this.direction = init?.direction === "columns" ? "columns" : "rows";
    this.addInput("frame", cubeAdoptIn("Table / Cube"));
    this.addInput("lookup", strComboIn("Lookup"));
    for (const k of XLookupNode.axisKeys(this.direction)) this.addInput(k, XLookupNode.axisInput(k));
    this.addInput("ifNotFound", strIn("If not found"));
    this.addOutput("value", trueAnyOut("Value"));
  }

  /** The two sockets that say where to search and what comes back, per direction. */
  static axisKeys(d: LookupDirection): [string, string] {
    return d === "columns" ? ["inRow", "returnRow"] : ["inColumn", "returnColumn"];
  }
  static axisInput(key: string) {
    switch (key) {
      case "inRow": return numIn("In row");
      case "returnRow": return numIn("Return row");
      case "inColumn": return strIn("In column");
      default: return strIn("Return");
    }
  }

  /** Swaps the axis sockets; the caller prunes the departing ones' cables first. */
  setDirection(next: LookupDirection): string[] {
    if (next === this.direction) return [];
    const departing = XLookupNode.axisKeys(this.direction);
    for (const k of departing) { if (this.inputs[k]) this.removeInput(k); delete this.literals[k]; delete this.stringLiterals[k]; }
    this.direction = next;
    for (const k of XLookupNode.axisKeys(next)) {
      if (!this.inputs[k]) this.addInput(k, XLookupNode.axisInput(k));
      if (next === "rows") this.stringLiterals[k] = "";
    }
    return departing;
  }

  /** A blank Return is the whole row; a named one carries its column's family on the combo rung (a lookup list
   *  gives a list), so a date column's serials show as dates ([[C44]] dateSerials). */
  passthrough(): PassthroughSpec[] {
    return [{
      output: "value",
      inputs: ["frame"],
      combine: "single",
      project: (ctx) => {
        if (this.direction === "columns") return this.acrossProjection(ctx);
        const ret = ctx.wired("returnColumn") ? null : (this.stringLiterals.returnColumn ?? "").trim();
        const shape = ctx.shapeOf("frame");
        const col = ret && shape && !shape.dynamic ? shape.columns.find((c) => c.name === ret) : undefined;
        // A wired lookup may be a list, which returns a list of rows.
        const oneRow = !ctx.wired("lookup");
        return {
          frame: ret === "" ? (oneRow ? "frame" : "trueany") : col ? comboOfFamily(col.type) ?? "trueany" : "trueany",
          cube: ret === "" && oneRow ? "cube" : "trueany",
          tables: "trueany",
        };
      },
    }];
  }

  /** Across, a typed lookup naming a column of a known shape, searched among the names, gives that column's family:
   *  its cell or the whole column, both on the combo rung. Anything else is only known at run time. */
  private acrossProjection(ctx: ProjectContext): { frame: SocketDataType; cube: SocketDataType; tables: "trueany" } {
    const byName = !ctx.wired("lookup") && !ctx.wired("inRow") && !this.literals.inRow;
    const name = (this.stringLiterals.lookup ?? "").trim();
    const shape = byName && name ? ctx.shapeOf("frame") : null;
    // Names match as the core's lookup does, ignoring case.
    const col = shape && !shape.dynamic ? shape.columns.find((c) => c.name.toLowerCase() === name.toLowerCase()) : undefined;
    return { frame: col ? comboOfFamily(col.type) ?? "trueany" : "trueany", cube: "trueany", tables: "trueany" };
  }

  data(inputs: Record<string, unknown[] | undefined>): { value: CubeCell | null } {
    return nodeOnCore(this, inputs) as { value: CubeCell | null };
  }
}

// ─── DESCRIBE ──────────────────────────────────────────────────────────────────
export class DescribeNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    frame: "One output row per column: count / blank / distinct for every column; mean, std, min, quartiles, max for the number columns, with min and max for dates.",
  };
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  width = 190; height = 140;

  constructor(init?: { label?: string }) {
    super("Describe");
    this.label = init?.label ?? "Describe";
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("frame", frameOut("Summary"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    return ctx.wired("frame") ? shapeOnCore("describeFrame", [{ columns: [] }]) : null;
  }

  /** The Dashboard view's tiles, which the body shows beside its summary; they ride beside the frame ([[C127]] pivotView). */
  describeTiles?: DescribeTile[];
  static coreWatch = "describeTiles";
  coreWatched(): void {
    const tiles = this.describeTiles;
    const out = this.cachedResult;
    if (tiles && isFrameValue(out)) setDescribeTiles(out, tiles);
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

// ─── CORRELATION MATRIX ────────────────────────────────────────────────────────
export const CORR_METHOD_META = {
  pearson:    { label: "Pearson",    description: "Linear correlation r between every pair of number columns." },
  spearman:   { label: "Spearman",   description: "Rank correlation ρ: any monotone relation, robust to outliers." },
  kendall:    { label: "Kendall",    description: "Kendall's τ-b from concordant / discordant pairs." },
  covariance: { label: "Covariance", description: "Sample covariance between every pair of number columns. `df.cov`, R `cov`." },
} satisfies Record<CorrMethod, { label: string; description: string }>;

export class CorrMatrixNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    frame: "Each pair uses the rows where BOTH columns are present (pairwise complete), so a patchy frame still answers; a pair with no variance is a blank cell.",
  };
  label: string;
  method: CorrMethod = "pearson";
  cachedResult: FrameValue | SolError | null = null;
  width = 190; height = 170;

  constructor(init?: { label?: string; method?: CorrMethod }) {
    super("CorrMatrix");
    this.label = init?.label ?? "Correlation Matrix";
    if (init?.method) this.method = init.method;
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("frame", frameOut("Matrix"));
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    return input ? shapeOnCore("correlationMatrix", [input], [this.method]) : null;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

// ─── K-MEANS / PCA / LOGISTIC ─────────────────────────────────────────────────

export class KMeansNode extends GraphNode {
  static inputRoles = { k: required };
  static socketDocs: Record<string, string> = {
    frame: "Every number column is a feature; rows with a blank get no cluster. Scale features first when their units differ, with Normalize.",
    k: "How many clusters.",
    labels: "Cluster 1…k per row of the frame, in first-appearance order; blank for a skipped row.",
    centers: "One row per cluster: its center on every feature and its size.",
  };
  label: string;
  literals: Record<string, number> = { k: 3 };
  cachedLabels: (number | null)[] | SolError | null = null;
  cachedCenters: FrameValue | null = null;
  width = 200; height = 190;

  constructor(init?: { label?: string }) {
    super("KMeans");
    this.label = init?.label ?? "K-Means";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("k", numIn("Clusters"));
    this.addOutput("labels", numListOut("Cluster"));
    this.addOutput("centers", frameOut("Centers"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { labels: (number | null)[] | SolError | null; centers: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { labels: (number | null)[] | SolError | null; centers: FrameValue | SolError | null };
  }
}

export class PcaNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    frame: "Every number column is a feature; rows with a blank are left out of the fit and get blank scores.",
    scores: "The rows in the new axes: PC1, PC2, …, one column per feature, highest variance first.",
    loadings: "How much each feature contributes to each axis, a row per feature.",
    explained: "Share of the total variance per component; the first few usually carry almost all of it.",
  };
  label: string;
  standardize = false;
  cachedScores: FrameValue | SolError | null = null;
  cachedLoadings: FrameValue | null = null;
  cachedExplained: number[] | null = null;
  width = 200; height = 215;

  constructor(init?: { label?: string; standardize?: boolean }) {
    super("Pca");
    this.label = init?.label ?? "PCA";
    if (init?.standardize) this.standardize = true;
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("scores", frameOut("Scores"));
    this.addOutput("loadings", frameOut("Loadings"));
    this.addOutput("explained", numListOut("Explained"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { scores: FrameValue | SolError | null; loadings: FrameValue | null; explained: number[] | null };
  }
}

export class LogisticNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    frame: "The target column is 0/1 (or TRUE/FALSE); every other number column is a feature. Rows with a blank are left out.",
    target: "Name of the 0/1 column to predict.",
    coefficients: "Intercept first, then one row per feature: the log-odds coefficient, its standard error, z, and the Wald p.",
    probabilities: "Fitted P(target = 1) per row of the frame; blank for a skipped row.",
  };
  label: string;
  stringLiterals: Record<string, string> = { target: "" };
  cachedCoefficients: FrameValue | SolError | null = null;
  cachedProbabilities: (number | null)[] | null = null;
  width = 210; height = 200;

  constructor(init?: { label?: string }) {
    super("Logistic");
    this.label = init?.label ?? "Logistic Regression";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("target", strIn("Target"));
    this.addOutput("coefficients", frameOut("Coefficients"));
    this.addOutput("probabilities", numListOut("Probabilities"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { coefficients: FrameValue | SolError | null; probabilities: (number | null)[] | null } {
    return nodeOnCore(this, inputs) as { coefficients: FrameValue | SolError | null; probabilities: (number | null)[] | null };
  }
}

// ─── WINDOW ────────────────────────────────────────────────────────────────────
export const WINDOW_FN_META = {
  row_number:   { label: "Row number",        description: "1, 2, 3… within each group in the chosen order. SQL `ROW_NUMBER`, pandas `cumcount()+1`." },
  rank:         { label: "Rank",              description: "Competition rank by the Order column within the group (ties share the best rank, then skip). SQL `RANK`, dplyr `min_rank`." },
  dense_rank:   { label: "Dense rank",        description: "Rank without gaps after ties. SQL `DENSE_RANK`, dplyr `dense_rank`." },
  percent_rank: { label: "Percent rank",      description: "(rank − 1) ÷ (group size − 1): 0 for the first, 1 for the last. SQL `PERCENT_RANK`." },
  ntile:        { label: "N-tile",            description: "Bucket 1..N by position within the group. SQL `NTILE(n)`, dplyr `ntile`." },
  cumsum:       { label: "Running sum",       description: "Cumulative sum of the Value column within the group. pandas `groupby().cumsum()`, SQL `SUM() OVER`." },
  cumavg:       { label: "Running average",   description: "Cumulative mean within the group. SQL `AVG() OVER … ROWS UNBOUNDED PRECEDING`." },
  cummin:       { label: "Running min",       description: "Cumulative minimum within the group. pandas `cummin`." },
  cummax:       { label: "Running max",       description: "Cumulative maximum within the group. pandas `cummax`." },
  cumcount:     { label: "Running count",     description: "How many rows so far in the group, this one included." },
  lag:          { label: "Lag (previous)",    description: "The Value N rows earlier in the group (blank at the start). SQL `LAG`, pandas `shift(n)`, dplyr `lag`." },
  lead:         { label: "Lead (next)",       description: "The Value N rows later in the group (blank at the end). SQL `LEAD`, pandas `shift(−n)`, dplyr `lead`." },
  diff:         { label: "Difference",        description: "Value minus the previous row's Value in the group. pandas `groupby().diff`." },
  pct_change:   { label: "Percent change",    description: "(Value − previous) ÷ previous within the group. pandas `groupby().pct_change`." },
  rolling_sum:  { label: "Rolling sum (N)",   description: "Sum of the last N rows in the group, blank until N rows exist. pandas `groupby().rolling(N).sum`." },
  rolling_avg:  { label: "Rolling average (N)", description: "Mean of the last N rows in the group. pandas `groupby().rolling(N).mean`." },
  rolling_min:  { label: "Rolling min (N)",   description: "Minimum of the last N rows in the group." },
  rolling_max:  { label: "Rolling max (N)",   description: "Maximum of the last N rows in the group." },
  group_sum:    { label: "Group total",       description: "The group's sum of the Value, repeated on every row (a denominator without a join). pandas `transform('sum')`, SQL `SUM() OVER PARTITION BY`." },
  group_avg:    { label: "Group average",     description: "The group's mean of the Value on every row. pandas `transform`, `mean`." },
  group_min:    { label: "Group min",         description: "The group's minimum on every row." },
  group_max:    { label: "Group max",         description: "The group's maximum on every row." },
  group_count:  { label: "Group count",       description: "How many non-blank Values the group holds, on every row. pandas `transform`, `count`." },
  share:        { label: "Share of group",    description: "Value ÷ the group's total: each row's fraction of its group. The pandas group-share transform." },
  first:        { label: "First in group",    description: "The group's first Value (in the chosen order) on every row. SQL `FIRST_VALUE`." },
  last:         { label: "Last in group",     description: "The group's last Value on every row. SQL `LAST_VALUE`." },
} satisfies Record<WindowFn, { label: string; description: string }>;

export class WindowNode extends GraphNode {
  static inputRoles = { n: setting(3) };
  static socketDocs: Record<string, string> = {
    keys: "The partition: rows sharing these keys form a group. Leave it empty to treat the whole frame as one group.",
    orderBy: "The column that orders rows WITHIN each group before running / ranking / lagging. Leave it blank to keep the frame's row order.",
    column: "The Value column the function reads. Ranks and row numbers don't need one.",
    n: "Lag / lead offset, rolling window length, or N-tile bucket count.",
    name: "The new column's name; an existing column of that name is replaced.",
    frame: "The input frame with the new column appended; rows stay in their original order. pandas transform.",
  };
  label: string;
  agg: WindowFn = "cumsum";
  literals: Record<string, number> = { n: 3 };
  stringLiterals: Record<string, string> = { orderBy: "", column: "", name: "" };
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  width = 210; height = 300;

  constructor(init?: { label?: string; agg?: WindowFn }) {
    super("Window");
    this.label = init?.label ?? "Window";
    if (init?.agg) this.agg = init.agg;
    this.addInput("frame", cubeAdoptIn("Frame / Cube"));
    this.addInput("keys", strListIn("Partition by"));
    this.addInput("orderBy", strIn("Order by"));
    this.addInput("column", strIn("Value"));
    this.addInput("n", numIn("N"));
    this.addInput("name", strIn("New column"));
    this.addOutput("frame", tableAdoptOut("Frame"));
  }

  private outColumnName(name: string, column: string): string {
    return name.trim() || `${WINDOW_FN_META[this.agg].label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_$/, "")}${column.trim() ? "_" + column.trim() : ""}`;
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input) return null;
    if (ctx.wired("keys") || ctx.wired("orderBy") || ctx.wired("column") || ctx.wired("name")) return null;
    const column = (this.stringLiterals.column ?? "").trim();
    if (WINDOW_FN_NEEDS_COLUMN.has(this.agg) && !column) return input;
    const orderBy = (this.stringLiterals.orderBy ?? "").trim();
    return shapeOf({
      kind: "window", partitionBy: csvList(this.stringLiterals.keys), orderBy: orderBy || undefined, orderDir: "asc",
      fn: this.agg, column: column || undefined, as: this.outColumnName(this.stringLiterals.name ?? "", column),
      n: WINDOW_FN_NEEDS_N.has(this.agg) ? this.literals.n ?? 3 : undefined,
    }, input);
  }

  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);

  data(inputs: Inputs) {
    return nodeOnCore(this, inputs) as { frame: FrameOut };
  }
}
