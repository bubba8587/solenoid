// [[B17]], [[C48]]
import { ClassicPreset } from "rete";
import { nodeOnCore } from "../nodeOnCore";
import { chartOut } from "./shared";
import type { ChartValue } from "../chartValue";
import { readInput, numIn, dateIn, numListOut, tableOut, strTableOut, dateTableOut, logicalTableOut, listIn, listOut, strIn, strComboIn, strOut, strListIn, strListOut, dateListIn, dateListOut, logicalListIn, logicalListOut, frameIn, frameOut, cubeIn, cubeOut, cubeAdoptIn, tableAdoptOut, anyIn, anyDataIn, staticTrueAnyOut, adoptiveTableIn, adoptiveListIn, lambdaIn } from "./shared";
import { setting, required, LEFT_OUT } from "../inputRoles";
import { flatCubeToFrame } from "../frame";
import type { PassthroughSpec } from "./passthrough";
import { extractVariables, exprYieldsDate, compileEvaluator, rowRefNames, type ExprEvaluator } from "../excelFormula";
import { isLambdaValue } from "../lambdaValue";
import { volatileStamp } from "../volatileDates";
import { computeColumnCells, computeCubeColumnCells } from "../computedColumnCore";
import { planColumnUnits, exprDefinition, lambdaDefinition, lambdaCaptures, lambdaInPlan } from "../computedColumnUnits";
import { stripUnitCells } from "../unitBridge";
import { cubeRowTable, cubeCellsType } from "../cubeRows";
import { dropInputCables } from "../components/cablePrune";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { cableGhostStore } from "../cableState";
import type { FrameHint } from "../frameHint";
import { SolenoidSocket } from "../sockets";
import { isSolError, solError, SEES_ERRORS, type SolError } from "../errorValue";
import {
  colTypeForSocket,
  getColumn, addColumn, frameRowCount, makeHeaders,
  frameFromInputText, parseFrameSource, frameSourceToText,
  isCubeValue, isFrameValue, inferColumn,
  cubeRowCount, frameFromRows, cubeFromColumns,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "../frame";
import {
  pivotFrame,
  allocateFrame,
  demoteHeaders,
  reconcileFrames,
  type FilterCombine, type JoinHow, type AsofDirection, type AggOp, type DecisionNormalize, type LookupMatchMode, type LookupSearchMode,
} from "../frameVerbs";
import { pairIdsFromKeys } from "./logic";
import type { PivotSpec, FilterCondConfig } from "../frameVerbs";
import type { AllocateMode } from "./allocateOps";
import { settleGroup, settleLedger, type Expense } from "./settleOps";
import { payoffPlan, type PayoffOrder } from "./payoffOps";
import { describeFrame, correlationMatrix, WINDOW_FN_NEEDS_COLUMN, WINDOW_FN_NEEDS_N, type CorrMethod, type WindowFn } from "../frameVerbs";
export type { WindowFn } from "../frameVerbs";
export type { CorrMethod } from "../frameVerbs";
import { runFrameUnary, runFrameJoin, runFrameAppend, runFrameBindColumns, uploadFrame, readFrame, collectPreview, dropFrameRef, isFrameRef, materialize, readRefColumn, pivotOnEngine, computeColumnOnEngine, computeColumnOnRef, assembleOnEngine, frameBackend, type FrameInput, type FrameRef } from "../frameBackend";
import { bindColumns } from "../frameVerbs";
import {
  shapeOf, shapeOfJoin, shapeOfAppend, shapeOfAddIndex, shapeOfSplitColumn, shapeOfFrameValue,
  emptyFrameOf, totalLabelledKeys, type Shape, type ShapeColumn,
} from "../frameShape";
import { csvList, type FrameShapeContext } from "./frameShapeHook";
import { listLiteralText } from "../coerceInputs";
import type { ColumnPickerSpec } from "./columnPickerHook";
import type { CubeValue, CubeCell, CubeColumn } from "../frame";
import { type UnitCell, type ColumnUnit, isUnitCell } from "../unitValue";
import { tagCubeCellUnit, parseColumnUnitFromHeader } from "../unitColumn";
import { readPivotView, type PivotViewOptions } from "../pivotLayout";

function runVerb<T>(fn: () => T): T | SolError {
  try {
    return fn();
  } catch (e) {
    return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
  }
}

// ─── Lazy verb-node output ──────────────────────────────────────────────────────
export interface FrameVerbNode { _ref?: FrameRef | null; _gen?: number; cachedResult: FrameValue | CubeValue | SolError | null }

// widenToFrame repeats coerceInputs' frame-socket widening, which the cube-adoptive port skips; keep the two identical.
function widenToFrame(v: unknown): FrameValue {
  if (Array.isArray(v)) return Array.isArray((v as unknown[])[0]) ? frameFromRows(v as unknown[][]) : frameFromRows([v as unknown[]]);
  return frameFromRows([[v]]);
}

function rowVerbInput(v: unknown): FrameInput | CubeValue | null {
  if (v == null) return null;
  if (isCubeValue(v) || isFrameValue(v) || isFrameRef(v)) return v;
  return widenToFrame(v);
}

/** What the unit and date rules read of a row table: each column's name, type and unit. */
type TypedColumns = { columns: ReadonlyArray<{ name: string; type: FrameColType; unit?: ColumnUnit }> };

export function computedColumnType(
  name: string, cells: readonly FrameCell[], f: TypedColumns, definition: string | undefined,
  alias: Record<string, string | undefined> = {},
): FrameColType {
  const type = inferColumn(name, cells).type;
  if (type !== "number" || !definition) return type;
  const isDateName = (n: string) => f.columns.find((c) => c.name === (alias[n] ?? n))?.type === "date";
  return exprYieldsDate(definition, isDateName) ? "date" : type;
}

/** The cube twin of `addColumn`: a Cube carries its unit on its cells, so `unit` tags each number, list items included, and a replaced column keeps its place and format. */
function cubeWithColumn(cube: CubeValue, name: string, cells: CubeCell[], type: FrameColType | undefined, after: string, unit: ColumnUnit | null): CubeValue {
  const { clean } = parseColumnUnitFromHeader(name);
  const tagged = unit && type === "number" ? cells.map((v) => tagCubeCellUnit(v, unit) as CubeCell) : cells;
  const col: CubeColumn = { name: clean, cells: tagged, ...(type ? { type } : {}) };
  const at = cube.columns.findIndex((c) => c.name === clean);
  if (at >= 0) {
    const cols = cube.columns.slice();
    const format = cols[at].format;
    cols[at] = format ? { ...col, format } : col;
    return cubeFromColumns(cols);
  }
  const cols = [...cube.columns, col];
  if (after) {
    const a = cols.findIndex((c) => c.name === after);
    if (a < 0) throw solError("#REF!", `No column "${after}" to place after`);
    cols.splice(a + 1, 0, cols.pop()!);
  }
  return cubeFromColumns(cols);
}

/** Call before the verb's await; `emitFrame(this, beginPass(this), await …)` gets this from argument order. */
export function beginPass(node: FrameVerbNode): number {
  node._gen = (node._gen ?? 0) + 1;
  return node._gen;
}

export async function passFrame(f: FrameInput): Promise<FrameRef | FrameValue | SolError> {
  return isFrameRef(f) ? runFrameUnary(f, { kind: "drop", columns: [] }) : f;
}

export async function emitFrame(node: FrameVerbNode, gen: number, out: FrameRef | FrameValue | SolError | null): Promise<{ frame: FrameRef | FrameValue | SolError | null }> {
  const stale = () => {
    if (isFrameRef(out) && out !== node._ref) dropFrameRef(out);
    return { frame: null };
  };
  if (gen !== node._gen) return stale();
  const preview = await collectPreview(out);
  if (gen !== node._gen) return stale();
  if (node._ref && node._ref !== out) dropFrameRef(node._ref);
  node._ref = isFrameRef(out) ? out : null;
  node.cachedResult = preview;
  return { frame: out };
}

type Inputs = Record<string, unknown[] | undefined>;

/** A lazy verb's body run over refs: each input of `keys` holding a frame (not a ref, nor a Cube the body reads) is
 *  uploaded for a ref with nothing planned, and `uploaded` names those inputs, so a body passing one through answers
 *  that ref and the frame itself comes back. A failed upload is the answer. */
async function planOnBody<O extends Record<string, unknown>>(inputs: Inputs, keys: readonly string[], body: (inputs: Inputs) => O, cubes = true): Promise<O | SolError> {
  const resolved: Inputs = { ...inputs };
  const values = new Map<unknown, unknown>();
  const uploaded: string[] = [];
  for (const k of keys) {
    const v = inputs[k]?.[0];
    if (v == null || isFrameRef(v) || (cubes && isCubeValue(v))) continue;
    const ref = await uploadFrame(v as FrameValue);
    if (isSolError(ref)) return ref;
    values.set(ref, v);
    resolved[k] = [ref];
    uploaded.push(k);
  }
  if (uploaded.length) resolved.uploaded = uploaded;
  const out: Record<string, unknown> = body(resolved);
  const refs = keys.map((k) => resolved[k]?.[0]).filter(isFrameRef);
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (values.has(v)) out[k] = values.get(v);
    else if (isFrameRef(v)) out[k] = relinked(v, refs);
  }
  return out as O;
}

/** A plan the body extended from an input ref, its leading ops that ref's own objects: the backend reuses a flushed
 *  prefix by its ops' identity. */
function relinked(out: FrameRef, from: readonly FrameRef[]): FrameRef {
  const src = from.find((r) => r.__frameRef === out.__frameRef && r.__plan.length < out.__plan.length);
  return src ? { __frameRef: out.__frameRef, __plan: [...src.__plan, ...out.__plan.slice(src.__plan.length)] } : out;
}

type LazyOut = FrameRef | FrameValue | CubeValue | SolError | null;

/** A lazy verb's pass: its body over refs; a Cube's answer is the body's own, which it showed, a frame's is emitted. */
async function lazyPass(node: FrameVerbNode & { body(inputs: Inputs): { frame: LazyOut } }, inputs: Inputs): Promise<{ frame: LazyOut }> {
  const gen = beginPass(node);
  const out = await planOnBody(inputs, ["frame"], (i) => node.body(i));
  if (isSolError(out)) return emitFrame(node, gen, out);
  if (isCubeValue(inputs.frame?.[0]) && out.frame != null) return { frame: out.frame };
  return emitFrame(node, gen, out.frame as FrameRef | FrameValue | SolError | null);
}

/** `lazyPass` for a verb on a frame socket: a Cube there is uploaded as any other value. */
async function lazyFramePass(node: FrameVerbNode & { body(inputs: Inputs): { frame: LazyOut } }, inputs: Inputs): Promise<{ frame: FrameRef | FrameValue | SolError | null }> {
  const gen = beginPass(node);
  const out = await planOnBody(inputs, ["frame"], (i) => node.body(i), false);
  return emitFrame(node, gen, isSolError(out) ? out : out.frame as FrameRef | FrameValue | SolError | null);
}

// ─── FRAME INPUT ─────────────────────────────────────────────────────────────

export const lambdaSocketName = (key: string): string => `λ${key.replace(/^fn/, "")}`;

export class FrameInputNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | null = null;
  frameText: string;
  /** Holds `layout`, the Form view's Record layout; this declaration is what lets load restore it. */
  stringLiterals: Record<string, string> = {};
  /** Hiding keeps the text but makes it inert, so read `activeLayout`, never `stringLiterals.layout`. */
  layoutHidden: boolean;
  lambdaKeys: string[] = [];
  // Reserves the full default card (header, both add rows, the capped preview) so Tidy never stacks a neighbor into it.
  width = 240; height = 280;

  constructor(init?: { label?: string; frameText?: string; lambdaKeys?: string[]; layoutHidden?: boolean }) {
    super("FrameInput");
    this.label = init?.label ?? "Frame Input";
    this.frameText = init?.frameText ?? "A, B\n1, 2\n3, 4";
    this.layoutHidden = init?.layoutHidden ?? false;
    if (Array.isArray(init?.lambdaKeys)) this.lambdaKeys = init.lambdaKeys.filter((k) => typeof k === "string");
    for (const k of this.lambdaKeys) this.addInput(k, lambdaIn(lambdaSocketName(k)));
    this.addOutput("frame", frameOut("Frame"));
  }

  get activeLayout(): string | undefined {
    return this.layoutHidden ? undefined : this.stringLiterals.layout;
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

  private _built: { text: string; lams: unknown[]; stamp: number } | null = null;

  private _parsed: { text: string; source: ReturnType<typeof parseFrameSource>; shape?: Shape } | null = null;

  private parsedSource() {
    if (this._parsed?.text !== this.frameText) this._parsed = { text: this.frameText, source: parseFrameSource(this.frameText) };
    return this._parsed;
  }

  frameShape(): Shape {
    const parsed = this.parsedSource();
    return (parsed.shape ??= shapeOfFrameValue(frameFromInputText(this.frameText)));
  }

  /** The frame, built again only when the text, a wired λ or a TODAY/NOW recalculation changes it. */
  data(inputs: Record<string, unknown[] | undefined> = {}) {
    const lams = this.lambdaKeys.map((k) => inputs[k]?.[0]);
    const stamp = volatileStamp([this.frameText, ...lams.map((l) => (isLambdaValue(l) ? l.expr : ""))].join("\n"));
    const b = this._built;
    if (this.cachedResult && b && b.text === this.frameText && b.stamp === stamp && b.lams.length === lams.length && b.lams.every((v, i) => Object.is(v, lams[i]))) {
      return { frame: this.cachedResult };
    }
    this.lambdaCaptures = lams.map((l) => (isLambdaValue(l) ? [...(l.capturedValues ?? [])] : []));
    const out = nodeOnCore(this, inputs) as { frame: FrameValue };
    this.cachedResult = out.frame;
    this._built = { text: this.frameText, lams, stamp };
    return out;
  }

  /** Each wired λ's captured values with their units: a λ on the card wire carries only the numbers its body reads. */
  static coreFields = ["lambdaCaptures"] as const;
  lambdaCaptures: unknown[][] = [];
}

// ─── DISTINCT ────────────────────────────────────────────────────────────────

export class DistinctNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: unknown[] }) {
    return lazyPass(this, { ...inputs, frame: [rowVerbInput(inputs.frame?.[0] ?? null)] });
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
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

export class HeadNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: unknown[]; rows?: number[]; to?: number[] }) {
    return lazyPass(this, { ...inputs, frame: [rowVerbInput(inputs.frame?.[0] ?? null)] });
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

// ─── SORT FRAME ────────────────────────────────────────────────────────────────

export type FrameSortDir = "asc" | "desc";

export class SortFrameNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: unknown[]; column?: string[] }) {
    return lazyPass(this, { ...inputs, frame: [rowVerbInput(inputs.frame?.[0] ?? null)] });
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

// ─── FILTER FRAME ──────────────────────────────────────────────────────────────

export type { FilterCondConfig } from "../frameVerbs";

export class FilterFrameNode extends ClassicPreset.Node {
  label: string;
  combine: FilterCombine;
  /** Keyed by the pair id, the suffix of `column${id}`. */
  condConfig: Record<string, FilterCondConfig> = {};
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["Column", "Value"];
  cachedResult: FrameValue | CubeValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  stringLiterals: Record<string, string> = {};
  _gen?: number;
  _ref?: FrameRef | null;
  _refDropped?: FrameRef | null;
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

  private publishDropped(gen: number, out: FrameRef | FrameValue | SolError | null): FrameRef | FrameValue | SolError | null {
    if (gen !== this._gen) {
      if (isFrameRef(out) && out !== this._refDropped) dropFrameRef(out);
      return null;
    }
    if (this._refDropped && this._refDropped !== out) dropFrameRef(this._refDropped);
    this._refDropped = isFrameRef(out) ? out : null;
    return out;
  }

  async data(inputs: { frame?: unknown[]; [k: string]: unknown[] | undefined }) {
    const f = rowVerbInput(inputs.frame?.[0] ?? null);
    const gen = beginPass(this);
    const out = await planOnBody({ ...inputs, frame: [f] }, ["frame"], (i) => this.body(i));
    if (isSolError(out)) return { ...(await emitFrame(this, gen, out)), dropped: this.publishDropped(gen, out) };
    if (isCubeValue(f)) return out as { frame: CubeValue | SolError; dropped: CubeValue | SolError };
    return { ...(await emitFrame(this, gen, out.frame as FrameRef | FrameValue | SolError | null)), dropped: this.publishDropped(gen, out.dropped as FrameRef | FrameValue | SolError | null) };
  }

  body(inputs: Inputs): { frame: LazyOut; dropped: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut; dropped: LazyOut };
  }
}

// ─── JOIN ──────────────────────────────────────────────────────────────────────

export class JoinNode extends ClassicPreset.Node {
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

  async data(inputs: {
    left?: (FrameInput | null)[]; right?: (FrameInput | null)[];
    leftKey?: string[]; rightKey?: string[]; tolerance?: number[];
  }) {
    const left = inputs.left?.[0] ?? null;
    const right = inputs.right?.[0] ?? null;
    const lkRaw = readInput(inputs.leftKey, this.stringLiterals.leftKey ?? "");
    const rkRaw = readInput(inputs.rightKey, this.stringLiterals.rightKey ?? "");
    // Only the as-of join reads `tolerance`, so a wired blank must not blank the other joins.
    const tolerance = this.how === "asof" ? readInput(inputs.tolerance, this.literals.tolerance) : undefined;
    if (lkRaw === null || rkRaw === null || tolerance === null) {
      return emitFrame(this, beginPass(this), null);
    }
    const lk = lkRaw.trim();
    const rk = rkRaw.trim() || lk;
    if (left == null || right == null || (lk === "" && this.how !== "cross")) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), await runFrameJoin(left, right, {
      leftKey: lk, rightKey: rk, how: this.how,
      asofDirection: this.asofDirection, asofTolerance: tolerance,
    }));
  }
}

// ─── COLUMNS (KEEP / DROP) ───────────────────────────────────────────────────

function readColumnList(wired: string[][] | undefined): string[] | null {
  const v = readInput(wired, [] as string[]);
  return v === null ? null : v.filter((c): c is string => typeof c === "string");
}

export type ColumnsOp = "keep" | "drop";

export const COLUMNS_OP_META: Record<ColumnsOp, { label: string; description: string; fx: string }> = {
  keep: { label: "Keep", fx: "KEEPCOLS", description: "Keep only the named columns, in the order given." },
  drop: { label: "Drop", fx: "DROPCOLS", description: "Remove the named columns; the rest pass through." },
};

export class ColumnsNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: unknown[]; columns?: string[][] }) {
    return lazyPass(this, { ...inputs, frame: [rowVerbInput(inputs.frame?.[0] ?? null)] });
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
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

export class GroupByFrameNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: (FrameInput | CubeValue | null)[]; keys?: string[][]; column?: string[] }) {
    const raw = rowVerbInput(inputs.frame?.[0]);
    if (isCubeValue(raw) || this.totalDepth !== 0) return this.flatData(raw, inputs);
    return lazyPass(this, { ...inputs, frame: [raw] }) as Promise<{ frame: FrameRef | FrameValue | SolError | null }>;
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }

  /** A Cube flattened to the columns it groups, and the totals, which pivot the frame's cells, stay here. */
  private async flatData(raw: FrameInput | CubeValue | null, inputs: { keys?: string[][]; column?: string[] }) {
    const keys = readColumnList(inputs.keys);
    const colRaw = readInput(inputs.column, this.stringLiterals.column ?? "");
    if (raw == null || colRaw === null || keys === null) return emitFrame(this, beginPass(this), null);
    const col = colRaw.trim();
    const flat = isCubeValue(raw) ? flatCubeToFrame(raw, keys.length && col ? [...keys, col] : "scalar") : raw;
    if (isSolError(flat)) return emitFrame(this, beginPass(this), flat);
    const f = flat;
    if (!(keys.length && col)) return emitFrame(this, beginPass(this), await passFrame(f));
    if (this.totalDepth !== 0) {
      const mat = await readFrame(f);
      if (mat == null || isSolError(mat)) return emitFrame(this, beginPass(this), mat);
      const spec: PivotSpec = { rowFields: keys, colFields: [], values: [col], funcs: [this.agg], rowTotalDepth: this.totalDepth };
      const out = runVerb(() => pivotOnEngine(mat, spec) ?? pivotFrame(mat, spec));
      // A min or max of dates stays a date, as the plain groupBy's does (`shapeOf`).
      if (!isSolError(out) && (this.agg === "min" || this.agg === "max") && getColumn(mat, col)?.type === "date") {
        const last = out.columns.length - 1;
        out.columns[last] = { ...out.columns[last], type: "date" };
      }
      return emitFrame(this, beginPass(this), out);
    }
    return emitFrame(this, beginPass(this),
      await runFrameUnary(f, { kind: "groupBy", keys, aggs: [{ column: col, op: this.agg, as: col }] }));
  }
}

// ─── PIVOT / UNPIVOT ───────────────────────────────────────────────────────────

// The one stringification for filter keys, so the editor's excluded keys match the cells.
function pivotCellKey(v: FrameCell): string {
  if (v == null) return "";
  if (isSolError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
function distinctKeys(values: readonly FrameCell[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = pivotCellKey(v);
    if (!seen.has(k)) { seen.add(k); out.push(k); if (out.length >= 200) break; }
  }
  return out;
}

export class PivotNode extends ClassicPreset.Node {
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
  // Per field, the value keys (`pivotCellKey`) to hide; ANDed with the wired `filter` mask.
  filterExclude: Record<string, string[]> = {};
  /** How the popup's Pivot view draws the output; display only. */
  pivotView: PivotViewOptions;
  /** Columns the Pivot view lists under each row group; display only ([[C128]] pivotDetails). */
  detailFields: string[] = [];
  cachedResult: FrameValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  sourceColumns: { name: string; type: FrameColType; distinct: string[] }[] = [];
  stringLiterals: Record<string, string> = { rowFields: "", colFields: "", values: "" };
  _gen?: number;
  _ref?: FrameRef | null;
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

  data(inputs: {
    frame?: (FrameInput | CubeValue | null)[];
    rowFields?: string[][]; colFields?: string[][]; values?: string[][];
    filter?: (boolean | null)[][];
  }) {
    const raw = inputs.frame?.[0] ?? null;
    const f = isCubeValue(raw) ? flatCubeToFrame(raw, "scalar") as FrameValue : raw;
    if (!f) { this.cachedResult = null; this.sourceColumns = []; return { frame: null }; }
    if (!isFrameRef(f)) {
      this.sourceColumns = f.columns.map((c) => ({ name: c.name, type: c.type, distinct: distinctKeys(c.values) }));
      // A value never takes the async branch, so this result is sync.
      return this.computePivot(f, f, inputs) as { frame: FrameValue | SolError | null };
    }
    const gen = beginPass(this);
    return (async () => {
      const schema = await collectPreview(f, 0);
      if (gen !== this._gen) return { frame: null };
      if (schema == null || isSolError(schema)) { this.cachedResult = schema; this.sourceColumns = []; return { frame: schema }; }
      const have = new Set(schema.columns.map((c) => c.name));
      const wanted = new Set<string>();
      for (const raw of [inputs.rowFields, inputs.colFields, inputs.values]) for (const n of readColumnList(raw) ?? []) if (have.has(n)) wanted.add(n);
      for (const key of ["rowFields", "colFields", "values"] as const) for (const n of csvList(this.stringLiterals[key])) if (have.has(n)) wanted.add(n);
      for (const n of [...Object.keys(this.filterExclude), ...this.detailFields]) if (have.has(n)) wanted.add(n);
      const cols = await materialize(Promise.all([...wanted].map((n) => readRefColumn(f, n))));
      if (gen !== this._gen) return { frame: null };
      if (isSolError(cols)) { this.cachedResult = cols; return { frame: cols }; }
      const byName = new Map(cols.filter((c): c is FrameColumn => c != null).map((c) => [c.name, c]));
      this.sourceColumns = schema.columns.map((c) => ({ name: c.name, type: c.type, distinct: byName.has(c.name) ? distinctKeys(byName.get(c.name)!.values) : [] }));
      const slice: FrameValue = { __frame: true, columns: schema.columns.map((c) => byName.get(c.name) ?? { name: c.name, type: c.type, values: [] }) };
      return this.computePivot(slice, f, inputs);
    })() as unknown as { frame: FrameValue | SolError | null };
  }

  private computePivot(f: FrameValue, source: FrameInput, inputs: {
    rowFields?: string[][]; colFields?: string[][]; values?: string[][];
    filter?: (boolean | null)[][];
  }): { frame: FrameInput | SolError | null } | Promise<{ frame: FrameInput | SolError | null }> {
    const valid = new Set(f.columns.map((c) => c.name));
    this.pruneFieldsTo(valid);
    const rowRaw = readColumnList(inputs.rowFields);
    const colRaw = readColumnList(inputs.colFields);
    const valRaw = readColumnList(inputs.values);
    if (rowRaw === null || colRaw === null || valRaw === null) { this.cachedResult = null; return { frame: null }; }
    const rowFields = rowRaw.filter((n) => valid.has(n));
    const colFields = colRaw.filter((n) => valid.has(n));
    const values = valRaw.filter((n) => valid.has(n));
    if (values.length === 0) {
      if (isFrameRef(source)) return passFrame(source).then((out) => emitFrame(this, beginPass(this), out));
      this.cachedResult = f; return { frame: f };
    }
    const funcs = values.map((name) => this.funcs[name] ?? this.agg);
    const spec: PivotSpec = {
      rowFields, colFields, values, funcs,
      rowTotalDepth: this.rowTotalDepth, colTotalDepth: this.colTotalDepth,
      rowSort: this.rowSort, colSort: this.colSort, relativeTo: this.relativeTo,
      filter: this.combineFilter(f, inputs.filter?.[0]),
      details: this.detailFields,
    };
    this.cachedResult = runVerb(() => pivotOnEngine(f, spec) ?? pivotFrame(f, spec));
    return { frame: this.cachedResult };
  }

  private pruneFieldsTo(valid: Set<string>): void {
    for (const key of ["rowFields", "colFields", "values"] as const) {
      const cur = this.stringLiterals[key] ?? "";
      if (cur.trim() === "") continue;
      const next = listLiteralText(csvList(cur).filter((n) => n !== "" && valid.has(n)));
      if (next !== cur) this.stringLiterals[key] = next;
    }
    for (const k of Object.keys(this.funcs)) if (!valid.has(k)) delete this.funcs[k];
    for (const k of Object.keys(this.filterExclude)) if (!valid.has(k)) delete this.filterExclude[k];
    if (this.detailFields.some((n) => !valid.has(n))) this.detailFields = this.detailFields.filter((n) => valid.has(n));
  }

  private combineFilter(f: FrameValue, wired?: (boolean | null)[]): (boolean | null)[] | undefined {
    const active = Object.entries(this.filterExclude).filter(([, ks]) => ks && ks.length > 0);
    if (active.length === 0) return wired;
    const sets = active.map(([name, ks]) => ({ set: new Set(ks), col: f.columns.find((c) => c.name === name) }));
    const n = frameRowCount(f);
    const mask: (boolean | null)[] = [];
    for (let i = 0; i < n; i++) {
      let keep = true;
      for (const { set, col } of sets) {
        if (col && set.has(pivotCellKey(col.values[i] ?? null))) { keep = false; break; }
      }
      mask.push(keep && (wired ? wired[i] === true : true));
    }
    return mask;
  }
}

export class UnpivotNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: (FrameInput | null)[]; idColumns?: string[][]; valueColumns?: string[][] }) {
    return lazyFramePass(this, inputs);
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

// ─── NEST / UNNEST (the flat ⟷ cube bridge) ───────────────────────────────────

export class NestNode extends ClassicPreset.Node {
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

export class UnnestNode extends ClassicPreset.Node {
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

export class AppendNode extends ClassicPreset.Node {
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

  async data(inputs: Record<string, (FrameInput | null)[] | undefined>) {
    const frames = this.valueInputKeys()
      .map((k) => inputs[k]?.[0] ?? null)
      .filter((f): f is FrameInput => f != null);
    if (frames.length === 0) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), frames.length === 1 ? await passFrame(frames[0]) : await runFrameAppend(frames));
  }
}

// ─── BIND COLUMNS ──────────────────────────────────────────────────────────────

export class BindColumnsNode extends ClassicPreset.Node {
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
    return shapeOfFrameValue(bindColumns(shapes.map(emptyFrameOf)));
  }

  async data(inputs: Record<string, (FrameInput | null)[] | undefined>) {
    const frames = this.valueInputKeys()
      .map((k) => inputs[k]?.[0] ?? null)
      .filter((f): f is FrameInput => f != null);
    if (frames.length === 0) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), frames.length === 1 ? await passFrame(frames[0]) : await runFrameBindColumns(frames));
  }
}

// ─── RENAME COLUMNS ────────────────────────────────────────────────────────────

export class RenameNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: (FrameInput | null)[]; from?: string[][]; to?: string[][] }) {
    return lazyFramePass(this, inputs);
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

// ─── SPLIT COLUMN / ADD INDEX (Power Query column ops) ──────────────────────────

export class SplitColumnNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: (FrameInput | null)[]; column?: string[]; delimiter?: string[]; into?: string[][] }) {
    return lazyFramePass(this, inputs);
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

export class AddIndexNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: (FrameInput | null)[]; start?: number[]; name?: string[] }) {
    return lazyFramePass(this, inputs);
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

export type FillDir = "down" | "up";

export class FillBlanksNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: (FrameInput | null)[]; columns?: string[][] }) {
    return lazyFramePass(this, inputs);
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

export type ReplaceMode = "cell" | "substring";

export class ReplaceValuesNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    column: "Leave blank to replace across every column.",
  };
  label: string;
  mode: ReplaceMode;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "", find: "", replace: "" };
  textLiterals = true;
  width = 200; height = 205;

  constructor(init?: { label?: string; mode?: ReplaceMode }) {
    super("ReplaceValues");
    this.label = init?.label ?? "Replace Values";
    this.mode = init?.mode ?? "cell";
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
      find: this.stringLiterals.find ?? "", replaceWith: this.stringLiterals.replace ?? "", mode: this.mode,
    }, input);
  }

  async data(inputs: { frame?: (FrameInput | null)[]; column?: string[]; find?: unknown[]; replace?: unknown[] }) {
    return lazyFramePass(this, inputs);
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

export class MergeColumnsNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: (FrameInput | null)[]; columns?: string[][]; separator?: string[]; name?: string[] }) {
    return lazyFramePass(this, inputs);
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

export type HeaderOp = "promote" | "demote";

export const HEADER_OP_META: Record<HeaderOp, { label: string; description: string }> = {
  promote: { label: "Promote first row", description: "The first row becomes the column names. Power Query: `Use First Row as Headers`." },
  demote:  { label: "Demote headers", description: "Column names drop into a first row of text. Columns auto-name `Col1`, `Col2`…" },
};

export class HeadersNode extends ClassicPreset.Node {
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
    return shapeOfFrameValue(demoteHeaders(emptyFrameOf(input)));
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

export class DropBlankRowsNode extends ClassicPreset.Node {
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
    return ctx.inputShape("frame");
  }

  async data(inputs: { frame?: (FrameInput | null)[] }) {
    return lazyFramePass(this, inputs);
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}

// ─── DECISION MATRIX ───────────────────────────────────────────────────────────

export type DecisionDetail = "summary" | "breakdown";

export class DecisionMatrixNode extends ClassicPreset.Node {
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

  // [[C126]] chainedDecisions: a Cube in ranks its nested choices too, so a Cube comes out.
  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input) return null;
    const label = input.columns.find((c) => c.type === "string");
    const criteria = input.columns.filter((c) => c !== label && (c.type === "number" || c.type === "logical"));
    if (criteria.length === 0) return null;
    const cols: ShapeColumn[] = [{ name: label?.name ?? "Option", type: "string" }];
    if (this.detail === "breakdown") for (const c of criteria) cols.push({ name: c.name, type: "number" });
    cols.push({ name: "Score", type: "number" }, { name: "Rank", type: "number" });
    const names = makeHeaders(cols.map((c) => c.name), cols.length);
    // Ruled out by and Filled in come and go with the data, so the shape is never the whole story.
    return { columns: cols.map((c, i) => ({ name: names[i], type: c.type })), dynamic: true };
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | CubeValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | CubeValue | SolError | null };
  }
}

// ─── DECISION SENSITIVITY ───────────────────────────────────────────────────────

export type SensitivityMode = "scenarios" | "flips";

export class DecisionSensitivityNode extends ClassicPreset.Node {
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

  // [[C125]] flipPoints: the mode swaps the output between a Cube of scenarios and a Frame of flip points.
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
    if (this.mode !== "flips") return null;
    return { columns: [
      { name: "Criterion", type: "string" }, { name: "Weight", type: "number" },
      { name: "Less at", type: "number" }, { name: "Winner if less", type: "string" },
      { name: "More at", type: "number" }, { name: "Winner if more", type: "string" },
    ] };
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { cube: CubeValue | FrameValue | SolError | null };
  }
}

// ─── CHOICE LADDER ──────────────────────────────────────────────────────────────

// [[C122]] choiceLadder
export class ChoiceLadderNode extends ClassicPreset.Node {
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
    if (!input) return null;
    const label = input.columns.find((c) => c.type === "string")?.name ?? "Option";
    const names = makeHeaders(["Rung", label, "Choice", "Score"], 4);
    const types = ["number", "string", "string", "number"] as const;
    // The cost columns follow, one per Limits row.
    return { columns: names.map((name, i) => ({ name, type: types[i] })), dynamic: true };
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

export class AllocatorNode extends ClassicPreset.Node {
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
    return input ? shapeOfFrameValue(allocateFrame(emptyFrameOf(input), this.mode, 0)) : null;
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

// ─── PAYOFF PLANNER ─────────────────────────────────────────────────────────
export type PayoffView = "summary" | "schedule";

export const PAYOFF_ORDER_META = {
  avalanche: { label: "Avalanche", description: "Extra goes to the highest APR first: the least interest overall." },
  snowball:  { label: "Snowball",  description: "Extra goes to the smallest balance first: the quickest first win." },
} satisfies Record<PayoffOrder, { label: string; description: string }>;

export class PayoffPlannerNode extends ClassicPreset.Node {
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
    if (!input) return null;
    if (this.mode === "summary") {
      const name = input.columns.find((c) => c.type === "string")?.name ?? "Debt";
      return { columns: [{ name, type: "string" }, { name: "Months", type: "number" }, { name: "Interest", type: "number" }, { name: "Payoff date", type: "date" }] };
    }
    return null; // Schedule has one column per debt row, so no static shape.
  }

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

/** As EDATE: a day past the target month's end lands on its last day. */
function addMonthsSerial(start: number, months: number): number {
  const d = new Date(Math.round((start - 25569) * 86400000));
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(y, mo, Math.min(d.getUTCDate(), lastDay)) / 86400000 + 25569);
}

function payoffColumns(f: FrameValue): { balCol?: FrameColumn; aprCol?: FrameColumn; minCol?: FrameColumn } {
  const byName = (...names: string[]) => { const set = new Set(names); return f.columns.find((c) => set.has(c.name.trim().toLowerCase())); };
  const nums = f.columns.filter((c) => c.type === "number");
  const balCol = byName("balance", "owed", "principal") ?? nums[0];
  const aprCol = byName("apr", "rate", "interest") ?? nums.filter((c) => c !== balCol)[0];
  const minCol = byName("min", "minimum", "min payment", "payment") ?? nums.filter((c) => c !== balCol && c !== aprCol)[0];
  return { balCol, aprCol, minCol };
}

export function payoffFrame(f: FrameValue, extra: number, order: PayoffOrder, view: PayoffView, start: number | null): FrameValue {
  const nameCol = f.columns.find((c) => c.type === "string");
  const { balCol, aprCol, minCol } = payoffColumns(f);
  if (!balCol || !aprCol || !minCol) throw solError("#VALUE!", "Payoff Planner needs Balance, APR and Min payment number columns");
  const rows = frameRowCount(f);
  const num = (col: FrameColumn, i: number, what: string): number => {
    const v = col.values[i];
    if (isSolError(v)) throw v;
    if (v == null) return 0;
    if (typeof v !== "number" || !Number.isFinite(v)) throw solError("#VALUE!", `Payoff Planner: every ${what} must be a number`);
    return v;
  };
  const debts = Array.from({ length: rows }, (_, i) => ({
    name: String(nameCol?.values[i] ?? `Debt ${i + 1}`),
    balance: num(balCol, i, "balance"), apr: num(aprCol, i, "APR"), min: num(minCol, i, "minimum payment"),
  }));
  let plan;
  try { plan = payoffPlan(debts, extra, order); }
  catch (e) { throw solError("#VALUE!", `Payoff Planner: ${e instanceof Error ? e.message : String(e)}`); }
  const money = { ...(balCol.unit ? { unit: balCol.unit } : {}), ...(balCol.format ? { format: balCol.format } : {}) };
  if (view === "schedule") {
    const months = plan.schedule.length;
    return { __frame: true, columns: [
      { name: "Month", type: "number", values: Array.from({ length: months }, (_, m) => m) },
      ...debts.map((d, j) => ({ name: d.name, type: "number" as const, values: plan.schedule.map((row) => row[j]), ...money })),
    ] };
  }
  return { __frame: true, columns: [
    { name: nameCol?.name ?? "Debt", type: "string", values: debts.map((d) => d.name) },
    { name: "Months", type: "number", values: plan.perDebt.map((d) => d.months) },
    { name: "Interest", type: "number", values: plan.perDebt.map((d) => d.interest), ...money },
    { name: "Payoff date", type: "date", values: plan.perDebt.map((d) => (start == null ? null : addMonthsSerial(start, d.months))) },
  ] };
}

// ─── GROUP COST SETTLE ──────────────────────────────────────────────────────
export type SettleSplit = "equal" | "weighted";
export type SettleMode = "totals" | "transactions";

export class SettleNode extends ClassicPreset.Node {
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

  private inGhosted(): boolean {
    const c = getOwningEditor(this.id)?.getConnections().find((c) => c.target === this.id && c.targetInput === "in");
    return !!c && cableGhostStore.isGhost(c.id);
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
    if (outKey === "transfers") return { columns: [{ name: "From", type: "string" }, { name: "To", type: "string" }, { name: "Amount", type: "number" }] };
    const name = this.mode === "totals"
      ? (ctx.inputShape("in")?.columns.find((c) => c.type === "string")?.name ?? "Person")
      : "Person";
    return { columns: [{ name, type: "string" }, { name: "Paid", type: "number" }, { name: "Owes", type: "number" }, { name: "Owed", type: "number" }, { name: "Net", type: "number" }] };
  }

  /** A ghosted cable (left incompatible by a mode change) does not feed, so the card shows empty rather than a
   *  coercion #VALUE!; the canvas says which, so it is read here and `body` settles. */
  data(inputs: Record<string, unknown[] | undefined>) {
    if (!this.inGhosted()) return this.body(inputs);
    this.cachedResult = null; this.cachedNet = null;
    return { transfers: null, net: null };
  }

  body(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { transfers: FrameValue | SolError | null; net: FrameValue | SolError | null };
  }
}

const ledgerNorm = (s: string) => s.trim().toLowerCase();
const ledgerColumn = (cube: CubeValue, ...names: string[]) => { const set = new Set(names); return cube.columns.find((c) => set.has(ledgerNorm(c.name))); };
const ledgerAmountColumn = (cube: CubeValue) => ledgerColumn(cube, "amount", "cost", "total", "price", "spend");

export function settleLedgerCube(cube: CubeValue): { transfers: FrameValue; net: FrameValue } {
  const norm = ledgerNorm;
  const col = (...names: string[]) => ledgerColumn(cube, ...names);
  const amountCol = ledgerAmountColumn(cube);
  const payerCol = col("paid by", "paidby", "payer", "paid", "by", "who paid", "from");
  const forCol = col("for", "split", "split between", "participants", "shared", "shared by", "shared with", "with", "beneficiaries", "owed by");
  if (!amountCol) throw solError("#VALUE!", "Group Cost Settle (Transactions) needs an Amount column");
  if (!payerCol) throw solError("#VALUE!", "Group Cost Settle (Transactions) needs a Paid by column");

  const canon = new Map<string, string>();
  const person = (raw: string): string => { const k = norm(raw); const seen = canon.get(k); if (seen) return seen; canon.set(k, raw.trim()); return raw.trim(); };
  const namesOf = (cell: CubeCell | undefined): string[] => {
    if (cell == null) return [];
    if (Array.isArray(cell)) return cell.flatMap(namesOf);
    if (isUnitCell(cell) || isFrameValue(cell) || isCubeValue(cell)) return [];
    return String(cell).split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean).map(person);
  };
  const amountOf = (cell: CubeCell | undefined): number => {
    if (isUnitCell(cell)) return Number.isFinite(cell.value) ? cell.value : 0;
    if (typeof cell === "number") return Number.isFinite(cell) ? cell : 0;
    if (typeof cell === "string") { const n = Number(cell.replace(/[,$£€\s]/g, "")); return Number.isFinite(n) ? n : 0; }
    return 0;
  };

  const rows = cubeRowCount(cube);
  const expenses: Expense[] = [];
  for (let i = 0; i < rows; i++) {
    const amount = amountOf(amountCol.cells[i]);
    const payers = namesOf(payerCol.cells[i]);
    if (payers.length === 0) continue;
    const named = forCol ? namesOf(forCol.cells[i]) : [];
    expenses.push({ amount, payers, beneficiaries: named.length ? named : null });
  }
  const r = settleLedger(expenses);
  const unit = ledgerMoney(amountCol.cells);
  const money = unit ? { unit } : {};
  return {
    transfers: { __frame: true, columns: [
      { name: "From", type: "string", values: r.transfers.map((t) => t.from) },
      { name: "To", type: "string", values: r.transfers.map((t) => t.to) },
      { name: "Amount", type: "number", values: r.transfers.map((t) => t.amount), ...money },
    ] },
    net: settleNetFrame(r.people, r.paid, r.shares, money),
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function settleNetFrame(
  names: string[], paidRaw: readonly number[], sharesRaw: readonly number[],
  money: Partial<Pick<FrameColumn, "unit" | "format">>, personLabel = "Person",
): FrameValue {
  const paid = paidRaw.map(r2);
  const net = sharesRaw.map(r2);
  const owes: number[] = [];
  const owed: number[] = [];
  net.forEach((n, i) => {
    const diff = r2(n - paid[i]);
    owes.push(diff > 0 ? diff : 0);
    owed.push(diff < 0 ? diff : 0);
  });
  return { __frame: true, columns: [
    { name: personLabel, type: "string", values: names },
    { name: "Paid", type: "number", values: paid, ...money },
    { name: "Owes", type: "number", values: owes, ...money },
    { name: "Owed", type: "number", values: owed, ...money },
    { name: "Net", type: "number", values: net, ...money },
  ] };
}

function ledgerMoney(cells: CubeCell[]): ColumnUnit | undefined {
  for (const c of cells) if (isUnitCell(c)) return c.display ? { dim: c.dim, display: c.display } : { dim: c.dim };
  return undefined;
}

function settleColumns(f: FrameValue): { shareCol?: FrameColumn; paidCol?: FrameColumn } {
  const byName = (...names: string[]) => { const set = new Set(names); return f.columns.find((c) => set.has(c.name.trim().toLowerCase())); };
  const nums = f.columns.filter((c) => c.type === "number");
  const shareCol = byName("share", "weight", "shares");
  return { shareCol, paidCol: byName("paid", "amount", "spent") ?? nums.find((c) => c !== shareCol) };
}

export function settleFrame(f: FrameValue, split: SettleSplit): { transfers: FrameValue; net: FrameValue } {
  const nameCol = f.columns.find((c) => c.type === "string");
  const { shareCol, paidCol } = settleColumns(f);
  if (!paidCol) throw solError("#VALUE!", "Group Cost Settle needs a Paid number column");
  const rows = frameRowCount(f);
  const people: { name: string; paid: number; share: number | null }[] = [];
  const at = new Map<string, number>();
  for (let i = 0; i < rows; i++) {
    const paid = paidCol.values[i];
    if (isSolError(paid)) throw paid;
    const share = shareCol ? shareCol.values[i] : null;
    const raw = String(nameCol?.values[i] ?? `Person ${i + 1}`).trim() || `Person ${i + 1}`;
    const p = typeof paid === "number" && Number.isFinite(paid) ? paid : 0;
    const s = typeof share === "number" && Number.isFinite(share) ? share : null;
    const key = raw.toLowerCase();
    const j = at.get(key);
    if (j === undefined) { at.set(key, people.length); people.push({ name: raw, paid: p, share: s }); }
    else { people[j].paid += p; if (s !== null) people[j].share = (people[j].share ?? 0) + s; }
  }
  const r = settleGroup(people, { weighted: split === "weighted" && !!shareCol });
  const money = { ...(paidCol.unit ? { unit: paidCol.unit } : {}), ...(paidCol.format ? { format: paidCol.format } : {}) };
  return {
    transfers: { __frame: true, columns: [
      { name: "From", type: "string", values: r.transfers.map((t) => t.from) },
      { name: "To", type: "string", values: r.transfers.map((t) => t.to) },
      { name: "Amount", type: "number", values: r.transfers.map((t) => t.amount), ...money },
    ] },
    net: settleNetFrame(people.map((p) => p.name), people.map((p) => p.paid), r.shares, money, nameCol?.name ?? "Person"),
  };
}

// ─── RECONCILE ───────────────────────────────────────────────────────────────

export class ReconcileNode extends ClassicPreset.Node {
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
    return shapeOfFrameValue(reconcileFrames(emptyFrameOf(left), emptyFrameOf(right), { leftKey: key, rightKey: key }).frame);
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null; summary: string | SolError };
  }
}

// ─── BUILD FRAME ───────────────────────────────────────────────────────────────

/** What a builder card's frame was last built from. Identity-stable memo: a fresh FrameValue each pass would
 *  re-upload the frame to the backend. */
const builtFrom = new WeakMap<object, readonly unknown[]>();

function sameBuild(node: object, sig: readonly unknown[]): boolean {
  const prev = builtFrom.get(node);
  return !!prev && prev.length === sig.length && prev.every((v, i) => Object.is(v, sig[i]));
}

export class BuildFrameNode extends ClassicPreset.Node {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    // Part of the memo key: a cable retyped between date and number must rebuild.
    const dt = this.inputs.matrix?.socket instanceof SolenoidSocket ? this.inputs.matrix.socket.dataType : undefined;
    const sig = [inputs.matrix?.[0], inputs.headers?.[0], dt];
    if (this.cachedResult && sameBuild(this, sig)) return { frame: this.cachedResult };
    const out = nodeOnCore(this, inputs) as { frame: FrameValue | null };
    builtFrom.set(this, sig);
    return out;
  }
}

// ─── FRAME FROM LISTS ─────────────────────────────────────────────────────────

export class FrameFromListsNode extends ClassicPreset.Node {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    const sig = this.valuePairKeys().flatMap(([nameK, valsK]) => {
      const sock = this.inputs[valsK]?.socket;
      return [inputs[nameK]?.[0], this.stringLiterals[nameK], inputs[valsK]?.[0], sock instanceof SolenoidSocket ? sock.dataType : undefined];
    });
    if (this.cachedResult && sameBuild(this, sig)) return { frame: this.cachedResult };
    const out = nodeOnCore(this, inputs) as { frame: FrameValue | null };
    builtFrom.set(this, sig);
    return out;
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

export class SplitFrameNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    matrix: "Under All, one text column blanks the whole matrix. Date cells ride as serials and booleans as 1 and 0.",
  };

  label: string;
  colType: SplitColType;
  cachedMatrix: (number | string)[][] | null = null;
  cachedHeaders: string[] | null = null;
  // True when the kept columns include text, so the Matrix output is null by design.
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

export type GetColumnReadAs = "number" | "text" | "date" | "logical";

export function getColumnOutput(readAs: GetColumnReadAs) {
  return readAs === "text" ? strListOut("Values")
    : readAs === "date" ? dateListOut("Values")
    : readAs === "logical" ? logicalListOut("Values")
    : listOut("Values");
}

type GetColumnValues =
  | (number | UnitCell | null | SolError)[]
  | string[]
  | (boolean | null | SolError)[]
  | SolError
  | null;

export class GetColumnNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "Number and Date reads coerce rather than filter: a text cell parses or becomes NaN, a boolean becomes 1 or 0, and blanks stay blank.",
  };

  label: string;
  readAs: GetColumnReadAs;
  cachedResult: (number | UnitCell | null | SolError)[] | string[] | (boolean | null | SolError)[] | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  stringLiterals: Record<string, string> = { name: "" };
  private _gen = 0;
  width = 200; height = 205;

  constructor(init?: { label?: string; readAs?: GetColumnReadAs }) {
    super("GetColumn");
    this.label = init?.label ?? "Get Column";
    this.readAs = init?.readAs ?? "number";
    this.addInput("frame", cubeIn("Table / Cube"));
    this.addInput("name", strIn("Column"));
    this.addOutput("values", getColumnOutput(this.readAs));
  }

  setReadAs(next: GetColumnReadAs): void {
    this.readAs = next;
    const out = this.outputs.values;
    if (out) out.socket = getColumnOutput(next).socket;
  }

  columnPickers(): ColumnPickerSpec[] { return [{ key: "name", frameInput: "frame" }]; }

  /** A ref's column is read from the backend first, and the body reads it as `column`: one column, an error or none. */
  data(inputs: { frame?: unknown[]; name?: string[] }): { values: GetColumnValues } {
    const gen = ++this._gen;
    const f = inputs.frame?.[0] ?? null;
    const name = readInput(inputs.name, this.stringLiterals.name ?? "");
    if (!isFrameRef(f) || typeof name !== "string" || name.trim() === "") return this.body(inputs);
    // The engine awaits a promise-returning data(); the cast keeps the sync signature.
    return (async () => {
      const col = await materialize(readRefColumn(f, name));
      if (gen !== this._gen) return { values: null };
      return this.body({ ...inputs, column: [col && !isSolError(col) ? { __frame: true, columns: [col] } : col] });
    })() as unknown as { values: GetColumnValues };
  }

  body(inputs: Record<string, unknown[] | undefined>): { values: GetColumnValues } {
    return nodeOnCore(this, inputs) as { values: GetColumnValues };
  }
}

// ─── ADD COLUMN ────────────────────────────────────────────────────────────────

export type AddColumnAddAs = "number" | "text" | "date" | "logical";

export function colTypeForAddAs(addAs: AddColumnAddAs): FrameColType {
  return addAs === "text" ? "string" : addAs;
}

export function addColumnInput(addAs: AddColumnAddAs) {
  return addAs === "text" ? strListIn("Values")
    : addAs === "date" ? dateListIn("Values")
    : addAs === "logical" ? logicalListIn("Values")
    : listIn("Values");
}

export class AddColumnNode extends ClassicPreset.Node {
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

type ComputedColumnInputs = { frame?: unknown[]; name?: string[]; after?: string[]; fn?: unknown[] } & Record<string, unknown[] | undefined>;

export class ComputedColumnNode extends ClassicPreset.Node {
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
  private _evaluator: ExprEvaluator | null = null;
  private _vars: string[] = [];
  private _rowRefs: string[] = [];
  private _compiledFor: string | null = null;

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

  /** Runs from data(), so socket changes wait for a microtask, and cables on a removed socket are pruned first. */
  private _reconcileSideSockets(needed: string[]): void {
    const current = this.sideVars;
    const added = needed.filter((v) => !current.includes(v));
    const removed = current.filter((v) => !needed.includes(v));
    if (added.length === 0 && removed.length === 0) return;
    this.sideVars = needed;
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

  _gen?: number;
  _ref?: FrameRef | null;

  data(inputs: ComputedColumnInputs) {
    const raw = inputs.frame?.[0] ?? null;
    // A ref's answer is a promise, which the compute pass awaits; a value's stays synchronous, as callers read it.
    return (isFrameRef(raw) ? this.dataOnRef(raw, inputs) : this.dataValue(inputs)) as ReturnType<ComputedColumnNode["dataValue"]>;
  }

  /** A frame in the engine: the formula runs there and only its answer column comes back, for the type, the unit
   *  refusal and the placement, which stay here. Anything the engine path doesn't carry reads the frame and runs
   *  as a value. */
  private async dataOnRef(ref: FrameRef, inputs: ComputedColumnInputs) {
    const gen = beginPass(this);
    const asValue = async () => {
      const mat = await readFrame(ref);
      // As coerceInputs reads a ref for a node that sees no errors: the error is the answer.
      if (isSolError(mat) && !SEES_ERRORS.has("ComputedColumnNode")) throw mat;
      return gen === this._gen ? this.dataValue({ ...inputs, frame: [mat] }) : { frame: null };
    };
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "");
    const afterRaw = readInput(inputs.after, this.stringLiterals.after ?? "");
    if (isLambdaValue(inputs.fn?.[0]) || Object.keys(this.bindings).length > 0 || !this.expr.trim() || nameRaw === null) return asValue();
    if (this._compiledFor !== this.expr) {
      this._evaluator = compileEvaluator(this.expr);
      this._vars = this._evaluator ? extractVariables(this.expr) : [];
      this._rowRefs = this._evaluator ? rowRefNames(this.expr) : [];
      this._compiledFor = this.expr;
    }
    if (!this._evaluator) return asValue();
    const schema = await collectPreview(ref, 0);
    if (!isFrameValue(schema)) return asValue();
    const name = nameRaw.trim() || "computed";
    const after = (afterRaw ?? "").trim();
    // The unit pass needs only the schema; a plan that rescales its inputs runs as a value ([[D100]] computedColumnInfersUnit).
    const sideRaw = (p: string) => readInput(inputs[p] as (number | null)[] | undefined, this.literals[p] ?? 0);
    const plan = planColumnUnits<FrameCell>(exprDefinition(this.expr), schema, { sideValue: sideRaw, authored: parseColumnUnitFromHeader(name).unit });
    if (isSolError(plan) || plan.table.columns !== schema.columns) return asValue();
    const sideValue = (p: string) => plan.side(sideRaw(p));
    const r = await computeColumnOnRef(ref, this.expr, schema.columns.map((c) => c.name), { sideValue, reserved: ["frame", "name", "fn", "after"] });
    if (!r || isSolError(r)) return asValue();
    try {
      const done = plan.finish(r.cells);
      if (done.cells !== r.cells) return asValue();
      if (gen !== this._gen) return { frame: null };
      this.sourceColumns = schema.columns.map((c) => c.name);
      this.defVars = this._vars;
      this._reconcileSideSockets(r.sideVars);
      const colType: FrameColType = this.addAs !== "auto" ? colTypeForAddAs(this.addAs) : computedColumnType(name, r.cells, schema, this.expr, this.bindings);
      // The schema's columns without their cells, units and formats kept, for addColumn's placement and naming.
      const shape: FrameValue = { __frame: true, columns: schema.columns.map((c) => ({ ...c, values: [] })) };
      const added = addColumn(shape, name, [], colType, done.unit ?? null);
      const replaced = added.columns.length === shape.columns.length;
      const fresh = replaced ? added.columns.find((c, i) => c !== shape.columns[i])! : added.columns[added.columns.length - 1];
      let cols = added.columns;
      if (after && !replaced) {
        const anchorIdx = cols.findIndex((c) => c.name === after);
        if (anchorIdx < 0) return emitFrame(this, gen, solError("#REF!", `No column "${after}" to place after`));
        cols = [...cols];
        cols.splice(anchorIdx + 1, 0, cols.pop()!);
      }
      const out = await assembleOnEngine(
        cols.map((c) => (c === fresh
          ? { handle: r.col, column: "out", as: c.name, type: colType }
          : { handle: r.base, column: c.name, as: c.name, type: c.type })),
        { __frame: true, columns: cols },
      );
      return emitFrame(this, gen, out);
    } finally {
      frameBackend().drop(r.col);
    }
  }

  private dataValue(inputs: ComputedColumnInputs) {
    const rawF = inputs.frame?.[0] ?? null;
    const isCube = isCubeValue(rawF);
    const f = rawF == null ? null : isCube ? cubeRowTable(rawF) : (isFrameValue(rawF) ? rawF : widenToFrame(rawF));
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "");
    const afterRaw = readInput(inputs.after, this.stringLiterals.after ?? "");
    const lam = inputs.fn?.[0];
    const out = (frame: FrameValue | CubeValue | SolError | null) => { this.cachedResult = frame; return { frame }; };
    this.sourceColumns = isCube ? rawF.columns.map((c) => c.name) : (f ? f.columns.map((c) => c.name) : []);
    if (!f || nameRaw === null) { this.defVars = []; this._reconcileSideSockets([]); return out(null); }
    const name = nameRaw.trim() || "computed";
    const after = (afterRaw ?? "").trim();

    const wired = isLambdaValue(lam) ? lam : null;
    if (!wired) {
      if (this._compiledFor !== this.expr) {
        this._evaluator = compileEvaluator(this.expr);
        this._vars = this._evaluator ? extractVariables(this.expr) : [];
        this._rowRefs = this._evaluator ? rowRefNames(this.expr) : [];
        this._compiledFor = this.expr;
      }
      if (!this.expr.trim()) { this.defVars = []; this._reconcileSideSockets([]); return out(isCube ? rawF : (f as FrameValue)); }
      if (!this._evaluator) { this.defVars = []; this._reconcileSideSockets([]); return out(solError("#VALUE!", "The formula does not parse")); }
    }

    const sideVals = this.sideVars.map((p) => readInput(inputs[p] as (number | null)[] | undefined, this.literals[p] ?? 0));
    const bindJson = JSON.stringify(this.bindings);
    const stamp = volatileStamp(wired ? wired.expr : this.expr);
    const k = this._lastKey;
    if (
      this.cachedResult && !isSolError(this.cachedResult) && k &&
      Object.is(k.f, rawF) && Object.is(k.lam, wired) && k.expr === this.expr && k.addAs === this.addAs &&
      k.name === name && k.after === after && k.bindings === bindJson && k.stamp === stamp &&
      k.sideVals.length === sideVals.length && k.sideVals.every((v, i) => Object.is(v, sideVals[i]))
    ) {
      return { frame: this.cachedResult };
    }
    const remember = (frame: FrameValue | CubeValue) => {
      this._lastKey = { f: rawF, lam: wired, expr: this.expr, addAs: this.addAs, name, after, bindings: bindJson, sideVals, stamp };
      return out(frame);
    };

    this.defVars = wired ? wired.params : this._vars;
    const sideRaw = (p: string) => readInput(inputs[p] as (number | null)[] | undefined, this.literals[p] ?? 0);
    const captures = lambdaCaptures(wired ? [wired] : []);
    const plan = planColumnUnits<CubeCell>(
      wired ? lambdaDefinition(wired) : exprDefinition(this.expr),
      f,
      { alias: this.bindings, sideValue: (p) => (captures.has(p) ? captures.get(p) : sideRaw(p)), authored: parseColumnUnitFromHeader(name).unit },
    );
    const runPlan = isSolError(plan) ? null : plan;
    const sideValue = (p: string) => (runPlan ? runPlan.side(sideRaw(p)) : stripUnitCells(sideRaw(p)));
    const reserved = ["frame", "name", "fn", "after"];
    const table = (runPlan ? runPlan.table : f) as FrameValue;
    const onEngine = !wired && !isCube && Object.keys(this.bindings).length === 0
      ? computeColumnOnEngine(table, this.expr, table.columns.reduce((m, c) => Math.max(m, c.values.length), 0), { sideValue, reserved }) : null;
    const computed = onEngine ?? (isCube ? computeCubeColumnCells : computeColumnCells)(
      runPlan ? runPlan.table : f,
      wired ? { kind: "lambda", lam: runPlan ? lambdaInPlan(wired, runPlan) : wired } : { kind: "expr", evaluator: this._evaluator!, vars: this._vars },
      {
        reserved,
        sideValue,
        alias: this.bindings,
        rowRefs: wired
          ? (wired.expr ? rowRefNames(wired.expr).filter((p) => !(wired.captured ?? []).includes(p)) : [])
          : this._rowRefs,
      },
    );
    if (isSolError(computed)) { this._reconcileSideSockets([]); return out(computed); }
    this._reconcileSideSockets(computed.sideVars);
    const done = runPlan ? runPlan.finish(computed.cells) : null;
    const values: CubeCell[] = isSolError(plan) ? computed.cells.map(() => plan) : done ? done.cells : computed.cells;
    const listType = isCube ? cubeCellsType(values) : null;
    const colType: FrameColType = this.addAs !== "auto" ? colTypeForAddAs(this.addAs)
      : listType ?? computedColumnType(name, values as FrameCell[], f, wired ? wired.expr : this.expr, this.bindings);

    if (isCube) {
      const cubeOut = runVerb(() => cubeWithColumn(rawF as CubeValue, name, values, colType, after, done?.unit ?? null));
      return isSolError(cubeOut) ? out(cubeOut) : remember(cubeOut);
    }

    // Detect replacement by column count, which is exact and avoids repeating addColumn's `Name (unit)` parsing.
    const frame = f as FrameValue;
    const result = addColumn(frame, name, values as FrameCell[], colType, done?.unit ?? null);
    const replacing = result.columns.length === f.columns.length;
    if (after && !replacing) {
      const anchorIdx = result.columns.findIndex((c) => c.name === after);
      if (anchorIdx < 0) return out(solError("#REF!", `No column "${after}" to place after`));
      const cols = [...result.columns];
      const added = cols.pop()!;
      cols.splice(anchorIdx + 1, 0, added);
      return remember({ __frame: true, columns: cols });
    }
    return remember(result);
  }

  private _lastKey: {
    f: unknown; lam: unknown; expr: string; addAs: ComputedColumnAs;
    name: string; after: string; bindings: string; sideVals: unknown[]; stamp: number;
  } | null = null;
}

// ─── GET ROW ────────────────────────────────────────────────────────────────────

export class GetRowNode extends ClassicPreset.Node {
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

export class XLookupNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    lookup: "Matching follows the In column's type: text ignores case, and a number or date column parses the lookup text.",
  };

  label: string;
  matchMode: LookupMatchMode;
  searchMode: LookupSearchMode;
  cachedResult: CubeCell | null = null;
  stringLiterals: Record<string, string> = { lookup: "", inColumn: "", returnColumn: "", ifNotFound: "" };
  // Skip rank widening so a scalar or bare list reaches the shape guard in data() instead of becoming a one-row cube.
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  width = 200; height = 350;

  constructor(init?: { label?: string; matchMode?: LookupMatchMode; searchMode?: LookupSearchMode }) {
    super("XLookup");
    this.label = init?.label ?? "XLOOKUP";
    this.matchMode = init?.matchMode ?? "exact";
    this.searchMode = init?.searchMode ?? "first";
    this.addInput("frame", cubeIn("Table / Cube"));
    this.addInput("lookup", strComboIn("Lookup"));
    this.addInput("inColumn", strIn("In column"));
    this.addInput("returnColumn", strIn("Return"));
    this.addInput("ifNotFound", strIn("If not found"));
    this.addOutput("value", staticTrueAnyOut("Value"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { value: CubeCell | null } {
    return nodeOnCore(this, inputs) as { value: CubeCell | null };
  }
}

// ─── DESCRIBE ──────────────────────────────────────────────────────────────────
export class DescribeNode extends ClassicPreset.Node {
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
    return ctx.wired("frame") ? shapeOfFrameValue(describeFrame(emptyFrameOf({ columns: [] }))) : null;
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

export class CorrMatrixNode extends ClassicPreset.Node {
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
    return input ? shapeOfFrameValue(correlationMatrix(emptyFrameOf(input), this.method)) : null;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

// ─── K-MEANS / PCA / LOGISTIC ─────────────────────────────────────────────────
import { kmeans, pca, logisticFit } from "./mlOps";

export function numericRows(f: FrameValue): { names: string[]; rows: number[][]; kept: number[]; total: number } {
  const cols = f.columns.filter((c) => c.type === "number");
  const total = frameRowCount(f);
  const rows: number[][] = [], kept: number[] = [];
  for (let r = 0; r < total; r++) {
    const row = cols.map((c) => c.values[r]);
    if (row.every((v) => typeof v === "number" && Number.isFinite(v))) { rows.push(row as number[]); kept.push(r); }
  }
  return { names: cols.map((c) => c.name), rows, kept, total };
}

type KMeansOutputs = { labels: (number | null)[]; centers: FrameValue };

export function kmeansOutputs({ names, rows, kept, total }: ReturnType<typeof numericRows>, k: number): KMeansOutputs | null {
  const r = kmeans(rows, k);
  if (!r) return null;
  const labels: (number | null)[] = new Array(total).fill(null);
  kept.forEach((row, i) => { labels[row] = r.labels[i]; });
  const counts = r.centers.map((_, c) => r.labels.filter((l) => l === c + 1).length);
  return { labels, centers: { __frame: true, columns: [
    { name: "Cluster", type: "number", values: r.centers.map((_, c) => c + 1) },
    ...names.map((nm, j) => ({ name: nm, type: "number" as const, values: r.centers.map((c) => c[j]) })),
    { name: "Count", type: "number", values: counts },
  ] } };
}

export class KMeansNode extends ClassicPreset.Node {
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

type PcaOutputs = { scores: FrameValue; loadings: FrameValue; explained: number[] };

export function pcaOutputs({ names, rows, kept, total }: ReturnType<typeof numericRows>, standardize: boolean): PcaOutputs | null {
  const r = pca(rows, { standardize });
  if (!r) return null;
  const pcNames = names.map((_, c) => `PC${c + 1}`);
  return {
    scores: { __frame: true, columns: pcNames.map((nm, c) => {
      const values: (number | null)[] = new Array(total).fill(null);
      kept.forEach((row, i) => { values[row] = r.scores[i][c]; });
      return { name: nm, type: "number" as const, values };
    }) },
    loadings: { __frame: true, columns: [
      { name: "Feature", type: "string", values: names },
      ...pcNames.map((nm, c) => ({ name: nm, type: "number" as const, values: names.map((_, j) => r.loadings[j][c]) })),
    ] },
    explained: r.ratio,
  };
}

export class PcaNode extends ClassicPreset.Node {
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

type LogisticOutputs = { coefficients: FrameValue; probabilities: (number | null)[] };

export function logisticOutputs(f: FrameValue, tcol: FrameColumn, features: FrameColumn[]): LogisticOutputs | null {
  const total = frameRowCount(f);
  const X: number[][] = [], y: number[] = [], kept: number[] = [];
  for (let r = 0; r < total; r++) {
    const tv = tcol.values[r];
    const yv = tv === true ? 1 : tv === false ? 0 : typeof tv === "number" && (tv === 0 || tv === 1) ? tv : null;
    const row = features.map((c) => c.values[r]);
    if (yv === null || !row.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    X.push(row as number[]); y.push(yv); kept.push(r);
  }
  const fit = logisticFit(X, y);
  if (!fit) return null;
  const probabilities: (number | null)[] = new Array(total).fill(null);
  kept.forEach((row, i) => { probabilities[row] = fit.probabilities[i]; });
  return { coefficients: { __frame: true, columns: [
    { name: "Term", type: "string", values: ["(Intercept)", ...features.map((c) => c.name)] },
    { name: "Coefficient", type: "number", values: fit.coefficients },
    { name: "Std Error", type: "number", values: fit.stdErrors },
    { name: "z", type: "number", values: fit.z },
    { name: "p", type: "number", values: fit.pValues },
  ] }, probabilities };
}

export class LogisticNode extends ClassicPreset.Node {
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

export class WindowNode extends ClassicPreset.Node {
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

  async data(inputs: { frame?: (FrameInput | CubeValue | null)[]; keys?: string[][]; orderBy?: string[]; column?: string[]; n?: number[]; name?: string[] }) {
    return lazyPass(this, { ...inputs, frame: [rowVerbInput(inputs.frame?.[0])] });
  }

  body(inputs: Inputs): { frame: LazyOut } {
    return nodeOnCore(this, inputs) as { frame: LazyOut };
  }
}
