// [[C64]], [[C48]]
import { ClassicPreset } from "rete";
import { readInput, numIn, dateIn, numListOut, tableOut, strTableOut, dateTableOut, logicalTableOut, listIn, listOut, strIn, strComboIn, strOut, strListIn, strListOut, dateListIn, dateListOut, logicalListIn, logicalListOut, frameIn, frameOut, cubeIn, cubeOut, cubeAdoptIn, tableAdoptOut, anyIn, anyDataIn, staticTrueAnyOut, adoptiveTableIn, adoptiveListIn, lambdaIn } from "./shared";
import { flatCubeToFrame } from "../frame";
import type { PassthroughSpec } from "./passthrough";
import { extractVariables, calledNames, exprYieldsDate, compileEvaluator, rowRefNames, parseFormula, type ExprEvaluator, type Ast } from "../excelFormula";
import { affineWeight, type Lam } from "../unitDimExpr";
import { isLambdaValue, type LambdaValue } from "../lambdaValue";
import { computeColumnCells } from "../computedColumnCore";
import { dropInputCables } from "../components/cablePrune";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { cableGhostStore } from "../cableState";
import { readFilterValue } from "./list";
import type { FrameHint } from "../frameHint";
import { toAnyMatrix } from "./coerce";
import { SolenoidSocket } from "../sockets";
import { parseDate } from "./date";
import { isSolError, solError, type SolError } from "../errorValue";
import { coerceLogical, decimalFromText } from "../valueKinds";
import { APP_LOCALE } from "../locale";
import {
  buildFrame, buildFrameTyped, typedColumn, colTypeForSocket,
  splitFrame, getColumn, addColumn, frameRowCount, frameHasTextColumns, makeHeaders,
  frameFromInputText, parseFrameSource, frameSourceToText, deriveFrame,
  formatFrameCell, isCubeValue, isFrameValue, inferColumn, frameToCube,
  selectCubeRows, cubeRowCount, frameFromRows, cubeFromColumns,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType, type FrameSourceColumn,
} from "../frame";
import {
  pivotFrame, nestFrame, unnestCube,
  splitColumn, addIndexColumn, decisionMatrix, decisionCriteria, decisionSensitivity, resolveDecisionWeights, allocateFrame,
  mergeColumns, promoteHeaders, demoteHeaders, dropBlankRows,
  lookupCell, lookupRowIndex,
  frameRowAt, cubeRowAt, asLookupSource, reconcileFrames,
  VALUELESS_FILTER_OPS, LIST_FILTER_OPS,
  sortCube, distinctCube, sliceCube, filterCube, selectCubeColumns, windowCube,
  type FilterCond, type FilterCombine, type JoinHow, type AsofDirection, type AggOp, type DecisionNormalize, type LookupMatchMode, type LookupSearchMode, type ReconcileSummary,
} from "../frameVerbs";
import { pairIdsFromKeys } from "./logic";
import type { PivotSpec, FilterCondConfig } from "../frameVerbs";
import type { AllocateMode } from "./allocateOps";
import { settleGroup, settleLedger, type Expense } from "./settleOps";
import { payoffPlan, type PayoffOrder } from "./payoffOps";
import { describeFrame, correlationMatrix, WINDOW_FN_NEEDS_COLUMN, WINDOW_FN_NEEDS_N, type CorrMethod, type WindowFn } from "../frameVerbs";
export type { WindowFn } from "../frameVerbs";
export type { CorrMethod } from "../frameVerbs";
import { runFrameUnary, runFrameJoin, runFrameAppend, runFrameBindColumns, readFrame, collectPreview, dropFrameRef, isFrameRef, frameBackend, materialize, flushRef, type FrameInput, type FrameRef } from "../frameBackend";
import { bindColumns } from "../frameVerbs";
import {
  shapeOf, shapeOfJoin, shapeOfAppend, shapeOfAddIndex, shapeOfSplitColumn, shapeOfFrameValue,
  emptyFrameOf, type Shape, type ShapeColumn,
} from "../frameShape";
import { csvList, type FrameShapeContext } from "./frameShapeHook";
import type { ColumnPickerSpec } from "./columnPickerHook";
import type { CubeValue, CubeCell, CubeColumn } from "../frame";
import { type UnitCell, type ColumnUnit, isUnitCell, isAffineDisplay } from "../unitValue";
import { tagFrameCellUnit, columnUnitFromSpec } from "../unitColumn";

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

function cubeToScalarFrame(cube: CubeValue): FrameValue {
  const columns = cube.columns
    .filter((c) => c.cells.every((cell) => !Array.isArray(cell) && !isFrameValue(cell) && !isCubeValue(cell)))
    .map((c) => inferColumn(c.name, c.cells));
  return { __frame: true, columns };
}

function cubeToExprFrame(cube: CubeValue): FrameValue {
  const columns = cube.columns.map((c) => {
    if (c.cells.every((cell) => !Array.isArray(cell) && !isFrameValue(cell) && !isCubeValue(cell))) {
      return inferColumn(c.name, c.cells);
    }
    const err = solError("#SHAPE!", `"${c.name}" has list or table cells; a formula reads scalar columns`);
    return { name: c.name, type: "string" as FrameColType, values: c.cells.map(() => err) };
  });
  return { __frame: true, columns };
}

function computedColumnType(
  name: string, cells: FrameCell[], f: FrameValue, definition: string | undefined,
  alias: Record<string, string | undefined> = {},
): FrameColType {
  const type = inferColumn(name, cells).type;
  if (type !== "number" || !definition) return type;
  const isDateName = (n: string) => f.columns.find((c) => c.name === (alias[n] ?? n))?.type === "date";
  return exprYieldsDate(definition, isDateName) ? "date" : type;
}

/** A row formula over readings on an offset scale (°C) is classified as Expression's is
 *  ([[C25]] firstClassUnits): a sum of readings, or a reading scaled or divided, is #UNIT!.
 *  A wired λ is read through its body. The result's unit stays the authored one. */
function readingsRefusal(
  definition: string | Ast, f: FrameValue, alias: Record<string, string | undefined> = {},
  lams: ReadonlyMap<string, unknown> = new Map(),
): SolError | null {
  const isReading = (n: string) => isAffineDisplay(f.columns.find((c) => c.name === (alias[n] ?? n))?.unit?.display);
  if (!f.columns.some((c) => isAffineDisplay(c.unit?.display))) return null;
  const ast = typeof definition === "string" ? parseFormula(definition) : definition;
  if (!ast) return null;
  const fns = new Map<string, Lam>();
  for (const [name, lam] of lams) {
    const body = isLambdaValue(lam) && lam.expr ? parseFormula(lam.expr) : null;
    if (body) fns.set(name, { params: (lam as LambdaValue).params, body });
  }
  const names = new Set<string>();
  const walk = (n: Ast): void => {
    if (n.t === "name" || n.t === "atcol" || n.t === "wholecol") { if (isReading(n.name)) names.add(n.name); }
    else if (n.t === "call") n.args.forEach(walk);
    else if (n.t === "apply") { walk(n.fn); n.args.forEach(walk); }
    else if (n.t === "unary" || n.t === "percent") walk(n.arg);
    else if (n.t === "bin") { walk(n.l); walk(n.r); }
  };
  walk(ast);
  for (const lam of fns.values()) walk(lam.body);
  if (names.size === 0) return null;
  const w = affineWeight(ast, names, names, fns);
  return isSolError(w) ? w : null;
}

/** A bare λ column reads its parameters' columns row by row. */
function bareLambdaCall(lam: LambdaValue): Ast {
  return { t: "call", name: "λ", args: lam.params.map((name): Ast => ({ t: "atcol", name })) };
}

function cubeWithColumn(cube: CubeValue, name: string, cells: CubeCell[], type: FrameColType | undefined, after: string): CubeValue {
  const col: CubeColumn = { name, cells, ...(type ? { type } : {}) };
  const at = cube.columns.findIndex((c) => c.name === name);
  if (at >= 0) { const cols = cube.columns.slice(); cols[at] = col; return cubeFromColumns(cols); }
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

// ─── FRAME INPUT ─────────────────────────────────────────────────────────────

export const lambdaSocketName = (key: string): string => `λ${key.replace(/^fn/, "")}`;

type CompiledColumnExpr = { evaluator: ExprEvaluator; vars: string[]; refs: string[] };

export class FrameInputNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | null = null;
  frameText: string;
  /** Holds `layout`, the Form view's Record layout; this declaration is what lets load restore it. */
  stringLiterals: Record<string, string> = {};
  /** Hiding keeps the text but makes it inert, so read `activeLayout`, never `stringLiterals.layout`. */
  layoutHidden: boolean;
  lambdaKeys: string[] = [];
  private _builtFrom: string | undefined;
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

  private _exprCache = new Map<string, CompiledColumnExpr | null>();

  private _computedFrom: { text: string; lams: unknown[] } | null = null;

  frameShape(): Shape {
    return shapeOfFrameValue(frameFromInputText(this.frameText));
  }

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    const source = parseFrameSource(this.frameText);
    const isComputed = (c: FrameSourceColumn) => !!c.expr;
    if (!source.some(isComputed)) {
      if (!this.cachedResult || this._builtFrom !== this.frameText) {
        this.cachedResult = frameFromInputText(this.frameText);
        this._builtFrom = this.frameText;
      }
      return { frame: this.cachedResult };
    }
    const lams = this.lambdaKeys.map((k) => inputs[k]?.[0]);
    if (
      this.cachedResult && this._computedFrom && this._computedFrom.text === this.frameText &&
      this._computedFrom.lams.length === lams.length &&
      this._computedFrom.lams.every((v, i) => Object.is(v, lams[i]))
    ) {
      return { frame: this.cachedResult };
    }

    const base = deriveFrame(source);
    const frame: FrameValue = {
      __frame: true,
      columns: base.columns.map((col, i) =>
        isComputed(source[i]) ? { name: col.name, type: "number" as FrameColType, values: [] } : col),
    };
    const nameToIdx = new Map(source.map((c, i) => [c.name, i] as const));
    const remaining = new Set(source.map((c, i) => (isComputed(c) ? i : -1)).filter((i) => i >= 0));
    const lamByName = new Map(this.lambdaKeys.map((k, j) => [lambdaSocketName(k), lams[j]] as const));
    const compiled = new Map<string, CompiledColumnExpr | null>();
    const exprAt = (i: number) => {
      const text = source[i].expr!;
      let entry = compiled.get(text);
      if (entry === undefined) {
        entry = this._exprCache.get(text);
        if (entry === undefined) {
          const evaluator = compileEvaluator(text);
          const vars = evaluator ? extractVariables(text) : [];
          entry = evaluator ? { evaluator, vars, refs: [...new Set([...vars, ...calledNames(text)])] } : null;
        }
        compiled.set(text, entry);
      }
      return entry;
    };
    const rowCount = () => frame.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
    const fill = (i: number, cell: FrameCell) =>
      (frame.columns[i] = { name: source[i].name, type: "number", values: Array(rowCount()).fill(cell) });

    let progress = true;
    while (progress && remaining.size > 0) {
      progress = false;
      for (const i of [...remaining]) {
        const c = source[i];
        const bare = lamByName.has(c.expr!.trim());
        const ex = bare ? null : exprAt(i);
        const used = bare ? [c.expr!.trim()] : (ex?.refs ?? []).filter((n) => lamByName.has(n) && !nameToIdx.has(n));
        const usedLams = used.map((n) => lamByName.get(n)).filter(isLambdaValue);
        const lam = bare ? (usedLams[0] ?? null) : null;
        const deps = [
          ...(lam ? lam.params : ex ? [...ex.vars, ...rowRefNames(c.expr!)] : []),
          ...usedLams.flatMap((l) => (l.expr ? rowRefNames(l.expr) : [])),
        ];
        if (deps.some((p) => { const d = nameToIdx.get(p); return d !== undefined && remaining.has(d); })) continue;
        remaining.delete(i);
        progress = true;
        if (usedLams.length < used.length) {
          fill(i, null);
          continue;
        }
        if (!bare && !ex) { fill(i, solError("#VALUE!", "The formula does not parse")); continue; }
        const refused = lam
          ? readingsRefusal(bareLambdaCall(lam), frame, {}, new Map([["λ", lam]]))
          : readingsRefusal(c.expr!, frame, {}, lamByName);
        if (refused) { fill(i, refused); continue; }
        const r = computeColumnCells(
          frame,
          lam
            ? { kind: "lambda", lam }
            : { kind: "expr", evaluator: ex!.evaluator, vars: [...ex!.vars, ...used.filter((n) => !ex!.vars.includes(n))] },
          {
            sideValue: (p, kind) => (!lam && lamByName.has(p)
              ? lamByName.get(p)
              : solError("#REF!", lam && kind === "var"
                ? `No column "${p}" — a table λ's side values ride its captures`
                : `No column "${p}"`)),
          },
        );
        if (isSolError(r)) {
          fill(i, r);
        } else {
          // Take only inferColumn's type: its constructed column coerces cells and would mangle per-row SolErrors.
          const type = computedColumnType(c.name, r.cells, frame, lam ? lam.expr : c.expr);
          frame.columns[i] = {
            name: c.name, type, values: r.cells,
            ...(type === "number" && c.unit ? { unit: columnUnitFromSpec(c.unit) ?? undefined } : {}),
          };
        }
      }
    }
    if (remaining.size > 0) {
      const cycle = [...remaining].map((i) => source[i].name).join(" → ");
      const err = solError("#REF!", `Circular computed columns: ${cycle}`);
      const n = rowCount();
      for (const i of remaining) {
        frame.columns[i] = { name: source[i].name, type: "number", values: Array(n).fill(err) };
      }
    }
    this._exprCache = compiled;
    this.cachedResult = frame;
    this._builtFrom = undefined;
    this._computedFrom = { text: this.frameText, lams };
    return { frame };
  }
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
    const f = rowVerbInput(inputs.frame?.[0] ?? null);
    if (isCubeValue(f)) { const r = runVerb(() => distinctCube(f)); this.cachedResult = r; return { frame: r }; }
    return emitFrame(this, beginPass(this), f != null ? await runFrameUnary(f, { kind: "distinct" }) : null);
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
    const f = rowVerbInput(inputs.frame?.[0] ?? null);
    const n = readInput(inputs.rows, this.literals.rows ?? 10);
    // Only the range op reads `to`, so a wired blank To must not blank the other slices.
    const to = this.op === "range" ? readInput(inputs.to, this.literals.to ?? n) : 0;
    const gen = beginPass(this);
    if (f == null || n === null || to === null) return emitFrame(this, gen, null);
    if (isCubeValue(f)) { const r = runVerb(() => sliceCube(f, this.op, n, this.op === "range" ? to : undefined)); this.cachedResult = r; return { frame: r }; }
    if (this.op === "first") return emitFrame(this, gen, await runFrameUnary(f, { kind: "head", n }));
    return emitFrame(this, gen, await runFrameUnary(f, { kind: "sliceRows", mode: this.op, n, to: this.op === "range" ? to : undefined }));
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
    const f = rowVerbInput(inputs.frame?.[0] ?? null);
    const col = readInput(inputs.column, this.stringLiterals.column ?? "");
    if (f == null || col === null) return emitFrame(this, beginPass(this), null);
    if (isCubeValue(f)) { const r = runVerb(() => col.trim() === "" ? f : sortCube(f, col.trim(), this.dir)); this.cachedResult = r; return { frame: r }; }
    return emitFrame(this, beginPass(this), col.trim() === "" ? await passFrame(f) : await runFrameUnary(f, { kind: "sort", by: col.trim(), dir: this.dir }));
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
    if (f == null) return { ...(await emitFrame(this, gen, null)), dropped: this.publishDropped(gen, null) };
    const conditions: FilterCond[] = [];
    for (const [colKey, valKey] of this.valuePairKeys()) {
      const id = colKey.slice(6);
      const colRaw = readInput(inputs[colKey] as string[] | undefined, this.stringLiterals[colKey] ?? "");
      const cfg = this.condConfig[id];
      const op = cfg?.op ?? "gt";
      const val = readFilterValue(inputs[valKey], this.stringLiterals[valKey]);
      const valueless = VALUELESS_FILTER_OPS.has(op);
      if (colRaw === null || (!valueless && val === null)) {
        return { ...(await emitFrame(this, gen, null)), dropped: this.publishDropped(gen, null) };
      }
      const col = String(colRaw).trim();
      if (col === "" || (!valueless && val!.trim() === "")) continue;
      conditions.push({ column: col, op, value: val as FrameCell, matchCase: cfg?.matchCase ?? false });
    }
    if (isCubeValue(f)) {
      const kept = runVerb(() => filterCube(f, this.combine, conditions));
      const dropped = runVerb(() => filterCube(f, this.combine, conditions, true));
      this.cachedResult = kept;
      return { frame: kept, dropped };
    }
    const listOp = conditions.find((c) => LIST_FILTER_OPS.has(c.op));
    if (listOp) {
      const err = solError("#SHAPE!", `${listOp.op} needs a list column — connect a cube, not a frame`);
      return { ...(await emitFrame(this, gen, err)), dropped: this.publishDropped(gen, err) };
    }
    if (conditions.length === 0) {
      return { ...(await emitFrame(this, gen, await passFrame(f))), dropped: this.publishDropped(gen, null) };
    }
    const kept = await runFrameUnary(f, { kind: "filterMulti", combine: this.combine, conditions });
    const dropped = await runFrameUnary(f, { kind: "filterMulti", combine: this.combine, conditions, complement: true });
    return { ...(await emitFrame(this, gen, kept)), dropped: this.publishDropped(gen, dropped) };
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
    const f = rowVerbInput(inputs.frame?.[0] ?? null);
    const cols = readColumnList(inputs.columns);
    const gen = beginPass(this);
    if (f == null || cols === null) return emitFrame(this, gen, null);
    if (isCubeValue(f)) {
      const r = runVerb(() => (this.op === "keep" && cols.length === 0 ? f : selectCubeColumns(f, cols, this.op === "drop" ? "drop" : "keep")));
      this.cachedResult = r;
      return { frame: r };
    }
    if (this.op === "drop") return emitFrame(this, gen, await runFrameUnary(f, { kind: "drop", columns: cols }));
    return emitFrame(this, gen, cols.length ? await runFrameUnary(f, { kind: "select", columns: cols }) : await passFrame(f));
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
    return shapeOf({ kind: "groupBy", keys, aggs: [{ column: col, op: this.agg, as: col }] }, input);
  }

  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);

  async data(inputs: { frame?: (FrameInput | CubeValue | null)[]; keys?: string[][]; column?: string[] }) {
    const raw = rowVerbInput(inputs.frame?.[0]);
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
      return emitFrame(this, beginPass(this), runVerb(() => pivotFrame(mat, {
        rowFields: keys, colFields: [], values: [col], funcs: [this.agg],
        rowTotalDepth: this.totalDepth,
      })));
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
  cachedResult: FrameValue | SolError | null = null;
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);
  sourceColumns: { name: string; type: FrameColType; distinct: string[] }[] = [];
  stringLiterals: Record<string, string> = { rowFields: "", colFields: "", values: "" };
  width = 220; height = 300;

  constructor(init?: {
    label?: string; agg?: AggOp; funcs?: Record<string, AggOp>;
    rowTotalDepth?: number; colTotalDepth?: number; rowSort?: number; colSort?: number; relativeTo?: number;
    filterExclude?: Record<string, string[]>;
  }) {
    super("Pivot");
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
    return shapeOf({ kind: "pivot", rowFields, colFields, values, funcs }, input);
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
    return (async () => {
      const schema = await collectPreview(f, 0);
      if (schema == null || isSolError(schema)) { this.cachedResult = schema; this.sourceColumns = []; return { frame: schema }; }
      const have = new Set(schema.columns.map((c) => c.name));
      const wanted = new Set<string>();
      for (const raw of [inputs.rowFields, inputs.colFields, inputs.values]) for (const n of readColumnList(raw) ?? []) if (have.has(n)) wanted.add(n);
      for (const key of ["rowFields", "colFields", "values"] as const) for (const n of (this.stringLiterals[key] ?? "").split(",")) if (have.has(n.trim())) wanted.add(n.trim());
      for (const n of Object.keys(this.filterExclude)) if (have.has(n)) wanted.add(n);
      const cols = await materialize((async () => {
        const h = await flushRef(f);
        return Promise.all([...wanted].map((n) => frameBackend().column(h, n)));
      })());
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
    };
    this.cachedResult = runVerb(() => pivotFrame(f, spec));
    return { frame: this.cachedResult };
  }

  private pruneFieldsTo(valid: Set<string>): void {
    for (const key of ["rowFields", "colFields", "values"] as const) {
      const cur = this.stringLiterals[key] ?? "";
      if (cur.trim() === "") continue;
      const next = cur.split(",").map((s) => s.trim()).filter((n) => n !== "" && valid.has(n)).join(", ");
      if (next !== cur) this.stringLiterals[key] = next;
    }
    for (const k of Object.keys(this.funcs)) if (!valid.has(k)) delete this.funcs[k];
    for (const k of Object.keys(this.filterExclude)) if (!valid.has(k)) delete this.filterExclude[k];
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
    const f = inputs.frame?.[0] ?? null;
    const ids = readColumnList(inputs.idColumns);
    const vals = readColumnList(inputs.valueColumns);
    if (f == null || ids === null || vals === null) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), vals.length ? await runFrameUnary(f, { kind: "unpivot", idColumns: ids, valueColumns: vals }) : await passFrame(f));
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

  data(inputs: { frame?: (FrameValue | null)[]; keys?: string[][]; nestedName?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    const keys = readColumnList(inputs.keys);
    const nameRaw = readInput(inputs.nestedName, this.stringLiterals.nestedName ?? "items");
    if (!f || keys === null || !keys.length || nameRaw === null) { this.cachedResult = null; return { cube: null }; }
    const name = nameRaw.trim() || "items";
    this.cachedResult = runVerb(() => nestFrame(f, keys, name));
    return { cube: this.cachedResult };
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

  data(inputs: { cube?: (CubeValue | null)[]; column?: string[] }) {
    const c = inputs.cube?.[0] ?? null;
    const colRaw = readInput(inputs.column, this.stringLiterals.column ?? "");
    if (!c || colRaw === null || !colRaw.trim()) { this.cachedResult = null; return { frame: null }; }
    const col = colRaw.trim();
    this.cachedResult = runVerb(() => unnestCube(c, col));
    return { frame: this.cachedResult };
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
    const f = inputs.frame?.[0] ?? null;
    // Read raw, not through readColumnList: `from` and `to` pair by index, so dropping a cell shifts the pairing.
    const from = readInput(inputs.from, [] as string[]);
    const to = readInput(inputs.to, [] as string[]);
    if (f == null || from === null || to === null) return emitFrame(this, beginPass(this), null);
    const map: Record<string, string> = {};
    for (let i = 0; i < Math.min(from.length, to.length); i++) {
      if (from[i] && to[i]) map[from[i]] = to[i];
    }
    return emitFrame(this, beginPass(this), Object.keys(map).length ? await runFrameUnary(f, { kind: "rename", map }) : await passFrame(f));
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

  data(inputs: { frame?: (FrameValue | null)[]; column?: string[]; delimiter?: string[]; into?: string[][] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const columnRaw = readInput(inputs.column, this.stringLiterals.column ?? "");
    const delimiter = readInput(inputs.delimiter, this.stringLiterals.delimiter ?? "");
    const into = readColumnList(inputs.into);
    if (columnRaw === null || delimiter === null || into === null) { this.cachedResult = null; return { frame: null }; }
    const column = columnRaw.trim();
    this.cachedResult = column ? runVerb(() => splitColumn(f, column, delimiter, into)) : f;
    return { frame: this.cachedResult };
  }
}

export class AddIndexNode extends ClassicPreset.Node {
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

  data(inputs: { frame?: (FrameValue | null)[]; start?: number[]; name?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const start = readInput(inputs.start, this.literals.start ?? 1);
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "Index");
    if (start === null || nameRaw === null) { this.cachedResult = null; return { frame: null }; }
    const name = nameRaw.trim() || "Index";
    this.cachedResult = runVerb(() => addIndexColumn(f, name, start));
    return { frame: this.cachedResult };
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
    const f = inputs.frame?.[0] ?? null;
    const colsRaw = readColumnList(inputs.columns);
    if (f == null || colsRaw === null) return emitFrame(this, beginPass(this), null);
    const columns = colsRaw.map((c) => c.trim()).filter(Boolean);
    return emitFrame(this, beginPass(this), await runFrameUnary(f, { kind: "fillBlanks", columns, dir: this.dir }));
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
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { column: "", find: "", replace: "" };
  autoLiterals = true;
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

  private findReplaceLiteral(key: string): string {
    const s = this.stringLiterals[key];
    if (s !== undefined && s !== "") return s;
    const n = this.literals[key];
    return n !== undefined ? String(n) : "";
  }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame");
    if (!input || ctx.wired("column")) return null;
    return shapeOf({
      kind: "replaceValues", column: this.stringLiterals.column ?? "",
      find: this.findReplaceLiteral("find"), replaceWith: this.findReplaceLiteral("replace"), mode: this.mode,
    }, input);
  }

  async data(inputs: { frame?: (FrameInput | null)[]; column?: string[]; find?: unknown[]; replace?: unknown[] }) {
    const f = inputs.frame?.[0] ?? null;
    const column = readInput(inputs.column, this.stringLiterals.column ?? "");
    const find = readFilterValue(inputs.find, this.findReplaceLiteral("find"));
    const replace = readFilterValue(inputs.replace, this.findReplaceLiteral("replace"));
    if (f == null || column === null || find === null || replace === null) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), await runFrameUnary(f, { kind: "replaceValues", column, find, replaceWith: replace, mode: this.mode }));
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
    return shapeOfFrameValue(mergeColumns(emptyFrameOf(input), columns, "", this.stringLiterals.name ?? ""));
  }

  data(inputs: { frame?: (FrameValue | null)[]; columns?: string[][]; separator?: string[]; name?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const colsRaw = readColumnList(inputs.columns);
    const separator = readInput(inputs.separator, this.stringLiterals.separator ?? "");
    const name = readInput(inputs.name, this.stringLiterals.name ?? "");
    if (colsRaw === null || separator === null || name === null) { this.cachedResult = null; return { frame: null }; }
    const columns = colsRaw.map((c) => c.trim()).filter(Boolean);
    this.cachedResult = columns.length < 2 ? f : runVerb(() => mergeColumns(f, columns, separator, name));
    return { frame: this.cachedResult };
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

  data(inputs: { frame?: (FrameValue | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = runVerb(() => (this.action === "promote" ? promoteHeaders(f) : demoteHeaders(f)));
    return { frame: this.cachedResult };
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

  data(inputs: { frame?: (FrameValue | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = runVerb(() => dropBlankRows(f, this.mode));
    return { frame: this.cachedResult };
  }
}

// ─── DECISION MATRIX ───────────────────────────────────────────────────────────

export type DecisionDetail = "summary" | "breakdown";

export class DecisionMatrixNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "Rows are options. Number and logical columns are the criteria, and the first text column names the options. Date columns are skipped.",
    weights: "A row per criterion: name, Weight (negative when lower is better), optional Norm (Raw, ÷Max, Rank). A missing criterion weighs 1 at the default Norm.",
  };

  label: string;
  normalize: DecisionNormalize;
  detail: DecisionDetail;
  cachedResult: FrameValue | SolError | null = null;
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
    this.addInput("frame", cubeIn("Scores / Cube"));
    this.addInput("weights", frameIn("Weights"));
    this.addOutput("frame", frameOut("Ranking"));
  }
  noWidenInputs: ReadonlySet<string> = new Set(["frame"]);

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
    return { columns: cols.map((c, i) => ({ name: names[i], type: c.type })), dynamic: input.dynamic };
  }

  data(inputs: { frame?: unknown[]; weights?: (FrameValue | null)[] }) {
    const raw = inputs.frame?.[0] ?? null;
    if (raw == null) { this.cachedResult = null; return { frame: null }; }
    const f = isCubeValue(raw) ? cubeToScalarFrame(raw) : (isFrameValue(raw) ? raw : widenToFrame(raw));
    const { weights, normOverrides } = resolveDecisionWeights(inputs.weights?.[0] ?? null, decisionCriteria(f));
    this.cachedResult = runVerb(() => decisionMatrix(f, weights, this.normalize, this.detail === "breakdown", normOverrides));
    return { frame: this.cachedResult };
  }
}

// ─── DECISION SENSITIVITY ───────────────────────────────────────────────────────

export class DecisionSensitivityNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    scores: "The options frame a Decision Matrix takes: rows are options, number columns criteria.",
    scenarios: "The Decision Matrix weights frame widened to many scenarios: one row per Criterion, and a number column per scenario (its header names it) carrying that scenario's weight. An optional Norm column applies per criterion across every scenario; a criterion a scenario omits weighs 1.",
  };

  label: string;
  normalize: DecisionNormalize;
  cachedResult: CubeValue | SolError | null = null;
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

  constructor(init?: { label?: string; normalize?: DecisionNormalize }) {
    super("DecisionSensitivity");
    this.label = init?.label ?? "Sensitivity";
    this.normalize = init?.normalize ?? "max";
    this.addInput("scores", frameIn("Scores"));
    this.addInput("scenarios", frameIn("Scenarios"));
    this.addOutput("cube", cubeOut("By scenario"));
  }

  data(inputs: { scores?: (FrameValue | null)[]; scenarios?: (FrameValue | null)[] }) {
    const scores = inputs.scores?.[0] ?? null;
    const scenarios = inputs.scenarios?.[0] ?? null;
    if (!scores || !scenarios) { this.cachedResult = null; return { cube: null }; }
    this.cachedResult = runVerb(() => decisionSensitivity(scores, scenarios, this.normalize));
    return { cube: this.cachedResult };
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

  data(inputs: { categories?: (FrameValue | null)[]; amount?: (number | null)[] }) {
    const f = inputs.categories?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const amount = readInput(inputs.amount, this.literals.amount ?? 0) ?? 0;
    this.cachedResult = runVerb(() => allocateFrame(f, this.mode, amount));
    return { frame: this.cachedResult };
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

  data(inputs: { debts?: (FrameValue | null)[]; extra?: (number | null)[]; start?: (number | null)[] }) {
    const f = inputs.debts?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const extra = readInput(inputs.extra, this.literals.extra ?? 0) ?? 0;
    const start = inputs.start ? inputs.start[0] : localMonthStartSerial();
    this.cachedResult = runVerb(() => payoffFrame(f, extra, this.order, this.mode, start));
    return { frame: this.cachedResult };
  }
}

function localMonthStartSerial(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), 1) / 86400000 + 25569;
}

function addMonthsSerial(start: number, months: number): number {
  const d = new Date(Math.round((start - 25569) * 86400000));
  d.setUTCMonth(d.getUTCMonth() + months);
  return Math.floor(d.getTime() / 86400000 + 25569);
}

export function payoffFrame(f: FrameValue, extra: number, order: PayoffOrder, view: PayoffView, start: number | null): FrameValue {
  const byName = (...names: string[]) => { const set = new Set(names); return f.columns.find((c) => set.has(c.name.trim().toLowerCase())); };
  const nameCol = f.columns.find((c) => c.type === "string");
  const nums = f.columns.filter((c) => c.type === "number");
  const balCol = byName("balance", "owed", "principal") ?? nums[0];
  const aprCol = byName("apr", "rate", "interest") ?? nums.filter((c) => c !== balCol)[0];
  const minCol = byName("min", "minimum", "min payment", "payment") ?? nums.filter((c) => c !== balCol && c !== aprCol)[0];
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

  data(inputs: { in?: (FrameValue | CubeValue | null)[] }) {
    const none = () => { this.cachedResult = null; this.cachedNet = null; return { transfers: null, net: null }; };
    const emit = (r: { transfers: FrameValue; net: FrameValue } | SolError) => {
      if (isSolError(r)) { this.cachedResult = r; this.cachedNet = r; return { transfers: r, net: r }; }
      this.cachedResult = r.transfers; this.cachedNet = r.net;
      return { transfers: r.transfers, net: r.net };
    };
    // A ghosted cable (left incompatible by a mode change) does not feed, so the card shows empty rather than a coercion #VALUE!.
    const raw = this.inGhosted() ? null : (inputs.in?.[0] ?? null);
    if (this.mode === "transactions") {
      const cube = isCubeValue(raw) ? raw : isFrameValue(raw) ? frameToCube(raw) : null;
      if (!cube) return none();
      return emit(runVerb(() => settleLedgerCube(cube)));
    }
    const f = isFrameValue(raw) ? raw : isCubeValue(raw) ? cubeToScalarFrame(raw) : null;
    if (!f) return none();
    return emit(runVerb(() => settleFrame(f, this.split)));
  }
}

export function settleLedgerCube(cube: CubeValue): { transfers: FrameValue; net: FrameValue } {
  const norm = (s: string) => s.trim().toLowerCase();
  const col = (...names: string[]) => { const set = new Set(names); return cube.columns.find((c) => set.has(norm(c.name))); };
  const amountCol = col("amount", "cost", "total", "price", "spend");
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

export function settleFrame(f: FrameValue, split: SettleSplit): { transfers: FrameValue; net: FrameValue } {
  const byName = (...names: string[]) => { const set = new Set(names); return f.columns.find((c) => set.has(c.name.trim().toLowerCase())); };
  const nameCol = f.columns.find((c) => c.type === "string");
  const nums = f.columns.filter((c) => c.type === "number");
  const shareCol = byName("share", "weight", "shares");
  const paidCol = byName("paid", "amount", "spent") ?? nums.find((c) => c !== shareCol);
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

  data(inputs: {
    left?: (FrameValue | null)[]; right?: (FrameValue | null)[];
    key?: string[]; priceColumn?: string[]; qtyColumn?: string[];
  }) {
    const left = inputs.left?.[0] ?? null;
    const right = inputs.right?.[0] ?? null;
    const keyRaw = readInput(inputs.key, this.stringLiterals.key ?? "");
    const priceRaw = readInput(inputs.priceColumn, this.stringLiterals.priceColumn ?? "");
    const qtyRaw = readInput(inputs.qtyColumn, this.stringLiterals.qtyColumn ?? "");
    if (keyRaw === null || priceRaw === null || qtyRaw === null) {
      this.cachedResult = null; this.cachedSummary = "";
      return { frame: null, summary: "" };
    }
    const key = keyRaw.trim();
    const priceColumn = priceRaw.trim() || undefined;
    const qtyColumn = qtyRaw.trim() || undefined;
    if (!left || !right || !key) {
      this.cachedResult = null; this.cachedSummary = "";
      return { frame: null, summary: "" };
    }
    const outcome = runVerb(() => reconcileFrames(left, right, { leftKey: key, rightKey: key, priceColumn, qtyColumn }));
    if (isSolError(outcome)) {
      this.cachedResult = outcome; this.cachedSummary = "";
      return { frame: outcome, summary: outcome };
    }
    this.cachedResult = outcome.frame;
    this.cachedSummary = summarizeReconcile(outcome.summary);
    return { frame: outcome.frame, summary: this.cachedSummary };
  }
}

// Markdown without headings, so it reads as plain text in a hero box and still renders through a markdown Format Controller.
function summarizeReconcile(s: ReconcileSummary): string {
  const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString(APP_LOCALE) : n.toLocaleString(APP_LOCALE, { maximumFractionDigits: 2 }));
  const parts = [`**${s.added}** added`, `**${s.removed}** removed`, `**${s.changed}** changed`, `**${s.unchanged}** unchanged`];
  if (s.skipped > 0) parts.push(`**${s.skipped}** skipped`);
  let out = parts.join(" · ");
  if (s.addedColumns.length || s.removedColumns.length) {
    const bits = [...s.addedColumns.map((n) => `+${n}`), ...s.removedColumns.map((n) => `−${n}`)];
    out += `\n\n_Columns: ${bits.join(" · ")}._`;
  }
  if (s.pvm) {
    const p = s.pvm;
    const sign = (n: number) => (n >= 0 ? "+" : "");
    out += `\n\n**Δ ${sign(p.delta)}${fmt(p.delta)}**: price ${sign(p.price)}${fmt(p.price)} · volume ${sign(p.volume)}${fmt(p.volume)} · mix ${sign(p.mix)}${fmt(p.mix)}`;
    if (p.excluded > 0) out += `\n\n_PVM excludes ${p.excluded} row${p.excluded === 1 ? "" : "s"} with blank or errored price or qty._`;
  }
  return out;
}

// ─── BUILD FRAME ───────────────────────────────────────────────────────────────

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

  // Identity-stable memo: a fresh FrameValue each pass would re-upload the frame to the backend.
  private _builtFromMatrix: unknown;
  private _builtFromHeaders: unknown;
  private _builtFromType: unknown;

  data(inputs: { matrix?: unknown[]; headers?: string[][] }) {
    const rawMatrix = inputs.matrix?.[0];
    const headers = inputs.headers?.[0];
    // Part of the memo key: a cable retyped between date and number must rebuild.
    const dt = this.inputs.matrix?.socket instanceof SolenoidSocket ? this.inputs.matrix.socket.dataType : undefined;
    if (this.cachedResult && rawMatrix === this._builtFromMatrix && headers === this._builtFromHeaders && dt === this._builtFromType) {
      return { frame: this.cachedResult };
    }
    const m = toAnyMatrix(rawMatrix);
    if (!m || m.length === 0) { this.cachedResult = null; return { frame: null }; }
    const known = colTypeForSocket(dt);
    const allNumeric = known === null && m.every((row) => row.every((c) => c === null || isSolError(c) || typeof c === "number"));
    this.cachedResult = known === "number" || allNumeric
      ? buildFrame(m as number[][], headers)
      : buildFrameTyped(m, headers, known);
    this._builtFromMatrix = rawMatrix;
    this._builtFromHeaders = headers;
    this._builtFromType = dt;
    return { frame: this.cachedResult };
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

  // Identity-stable memo: a fresh FrameValue each pass would re-upload the frame to the backend.
  private _sig: unknown[] = [];

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

  data(inputs: Record<string, unknown[]>) {
    const cols: { name: string; cells: unknown[]; known: FrameColType | null }[] = [];
    const sig: unknown[] = [];
    for (const [nameK, valsK] of this.valuePairKeys()) {
      const wired = inputs[valsK]?.[0];
      if (wired === undefined || wired === null) continue;
      const cells = Array.isArray(wired) ? wired : [wired];
      const nameRaw = readInput(inputs[nameK] as string[] | undefined, this.stringLiterals[nameK] ?? "");
      if (nameRaw === null) { this.cachedResult = null; this._sig = []; return { frame: null }; }
      const name = String(nameRaw).trim();
      const sock = this.inputs[valsK]?.socket;
      const known = colTypeForSocket(sock instanceof SolenoidSocket ? sock.dataType : undefined);
      cols.push({ name, cells, known });
      sig.push(name, wired, known);
    }
    if (cols.length === 0) { this.cachedResult = null; this._sig = []; return { frame: null }; }
    if (this.cachedResult && sig.length === this._sig.length && sig.every((v, i) => Object.is(v, this._sig[i]))) {
      return { frame: this.cachedResult };
    }
    const length = Math.max(...cols.map((c) => c.cells.length));
    const names = makeHeaders(cols.map((c) => c.name), cols.length);
    this.cachedResult = {
      __frame: true,
      columns: cols.map((c, i) => typedColumn(names[i], c.cells, length, c.known)),
    };
    this._sig = sig;
    return { frame: this.cachedResult };
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

  data(inputs: { frame?: (FrameValue | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedMatrix = null; this.cachedHeaders = null; this.cachedMixed = false; return { matrix: null, headers: null }; }
    const cols = this.colType === "all" ? f.columns : f.columns.filter((c) => c.type === this.colType);
    const headers = cols.map((c) => c.name);

    if (this.colType === "string") {
      const rows = frameRowCount({ __frame: true, columns: cols });
      const matrix: (number | string)[][] | null = cols.length
        ? Array.from({ length: rows }, (_, i) =>
            cols.map((c) => {
              const v = c.values[i];
              return typeof v === "string" ? v : isSolError(v) ? v.code : v == null ? "" : String(v);
            }))
        : null;
      this.cachedMatrix = matrix;
      this.cachedHeaders = headers;
      this.cachedMixed = false;
      return { matrix, headers };
    }

    const sub: FrameValue = { __frame: true, columns: cols };
    const { matrix } = splitFrame(sub);
    this.cachedMatrix = matrix;
    this.cachedHeaders = headers;
    this.cachedMixed = frameHasTextColumns(sub);
    return { matrix, headers };
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
  width = 200; height = 205;

  constructor(init?: { label?: string; readAs?: GetColumnReadAs }) {
    super("GetColumn");
    this.label = init?.label ?? "Get Column";
    this.readAs = init?.readAs ?? "number";
    this.addInput("frame", cubeIn("Table / Cube"));
    this.addInput("name", strIn("Column"));
    this.addOutput("values", getColumnOutput(this.readAs));
  }

  columnPickers(): ColumnPickerSpec[] { return [{ key: "name", frameInput: "frame" }]; }

  data(inputs: { frame?: unknown[]; name?: string[] }): { values: GetColumnValues } {
    const f = inputs.frame?.[0] ?? null;
    const name = readInput(inputs.name, this.stringLiterals.name ?? "");
    if (!f || name === null || name.trim() === "") { this.cachedResult = null; return { values: null }; }
    if (isCubeValue(f)) {
      const cc = f.columns.find((c) => c.name === name);
      if (!cc) { this.cachedResult = null; return { values: null }; }
      for (const cell of cc.cells) {
        if (Array.isArray(cell) || isFrameValue(cell) || isCubeValue(cell)) {
          this.cachedResult = null;
          return { values: solError("#SHAPE!", `"${name}" has list or table cells; Get Column reads a scalar column`) };
        }
      }
      return { values: this.readColumn(inferColumn(name, cc.cells)) };
    }
    const fr: FrameInput = isFrameValue(f) || isFrameRef(f) ? f : widenToFrame(f);
    // The engine awaits a promise-returning data(); the cast keeps the sync signature.
    if (isFrameRef(fr)) {
      return (async () => {
        const col = await materialize((async () => frameBackend().column(await flushRef(fr), name))());
        if (isSolError(col)) { this.cachedResult = null; return { values: col }; }
        if (!col) { this.cachedResult = null; return { values: null }; }
        return { values: this.readColumn(col) };
      })() as unknown as { values: GetColumnValues };
    }
    const col = getColumn(fr, name);
    if (!col) { this.cachedResult = null; return { values: null }; }
    return { values: this.readColumn(col) };
  }

  private readColumn(col: FrameColumn): GetColumnValues {
    if (this.readAs === "text") {
      // Format, don't String(): a date column must read as date text, not serials.
      const out = col.values.map((v) => {
        const c = formatFrameCell(col.type, v);
        return c == null ? "" : String(c);
      });
      this.cachedResult = out;
      return out;
    }
    if (this.readAs === "logical") {
      // Shares coerceLogical with Cast to Boolean so the two parse identically.
      const out = col.values.map((v) =>
        v === null ? null : isSolError(v) ? v : coerceLogical(v),
      );
      this.cachedResult = out;
      return out;
    }
    const colUnit = this.readAs === "number" && col.unit ? col.unit : undefined;
    const out = col.values.map((v) => {
      if (v === null) return null; // blank stays null, not NaN
      if (typeof v === "number") return colUnit ? (tagFrameCellUnit(v, colUnit) as number | UnitCell) : v;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (isSolError(v)) return v;
      if (typeof v === "string") {
        if (this.readAs === "date") {
          const d = parseDate(v);
          if (isSolError(d)) return d;
          return colUnit ? (tagFrameCellUnit(d, colUnit) as number | UnitCell) : d;
        }
        const n = decimalFromText(v);
        return colUnit ? (tagFrameCellUnit(n, colUnit) as number | UnitCell) : n;
      }
      return NaN;
    });
    this.cachedResult = out;
    return out;
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

  passthrough(): PassthroughSpec[] { return [{ output: "frame", inputs: ["frame"], combine: "single" }]; }

  frameShape(_outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("frame"); // null for a cube, whose shape rides the passthrough
    if (!input || ctx.wired("name")) return null;
    const name = (this.stringLiterals.name ?? "").trim() || "Col";
    return shapeOfFrameValue(addColumn(emptyFrameOf(input), name, [], colTypeForAddAs(this.addAs)));
  }

  data(inputs: { frame?: unknown[]; values?: FrameCell[][]; name?: string[] }) {
    const rawF = inputs.frame?.[0] ?? null;
    const isCube = isCubeValue(rawF);
    const f: FrameValue | null = rawF == null ? null : isCube ? null : (isFrameValue(rawF) ? rawF : widenToFrame(rawF));
    const values = inputs.values?.[0] ?? null;
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "");
    if ((!f && !isCube) || !values || nameRaw === null) { this.cachedResult = null; return { frame: null }; }
    const name = nameRaw.trim() || "Col";
    const colType = colTypeForAddAs(this.addAs);
    const rows = Math.max(isCube ? cubeRowCount(rawF as CubeValue) : frameRowCount(f!), values.length);
    const padded: FrameCell[] = Array.from({ length: rows }, (_, i) => (i < values.length ? values[i] : null));
    this.cachedResult = isCube
      ? cubeWithColumn(rawF as CubeValue, name, padded, colType, "")
      : addColumn(f!, name, padded, colType);
    return { frame: this.cachedResult };
  }
}

// ─── COMPUTED COLUMN ───────────────────────────────────────────────────────────

export type ComputedColumnAs = "auto" | AddColumnAddAs;

export class ComputedColumnNode extends ClassicPreset.Node {
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

  data(inputs: { frame?: unknown[]; name?: string[]; after?: string[]; fn?: unknown[] } & Record<string, unknown[] | undefined>) {
    const rawF = inputs.frame?.[0] ?? null;
    const isCube = isCubeValue(rawF);
    const f: FrameValue | null = rawF == null ? null : isCube ? cubeToExprFrame(rawF) : (isFrameValue(rawF) ? rawF : widenToFrame(rawF));
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
      if (!this.expr.trim()) { this.defVars = []; this._reconcileSideSockets([]); return out(isCube ? rawF : f); }
      if (!this._evaluator) { this.defVars = []; this._reconcileSideSockets([]); return out(solError("#VALUE!", "The formula does not parse")); }
    }

    const sideVals = this.sideVars.map((p) => readInput(inputs[p] as (number | null)[] | undefined, this.literals[p] ?? 0));
    const bindJson = JSON.stringify(this.bindings);
    const k = this._lastKey;
    if (
      this.cachedResult && !isSolError(this.cachedResult) && k &&
      Object.is(k.f, rawF) && Object.is(k.lam, wired) && k.expr === this.expr && k.addAs === this.addAs &&
      k.name === name && k.after === after && k.bindings === bindJson &&
      k.sideVals.length === sideVals.length && k.sideVals.every((v, i) => Object.is(v, sideVals[i]))
    ) {
      return { frame: this.cachedResult };
    }
    const remember = (frame: FrameValue | CubeValue) => {
      this._lastKey = { f: rawF, lam: wired, expr: this.expr, addAs: this.addAs, name, after, bindings: bindJson, sideVals };
      return out(frame);
    };

    this.defVars = wired ? wired.params : this._vars;
    const computed = computeColumnCells(
      f,
      wired ? { kind: "lambda", lam: wired } : { kind: "expr", evaluator: this._evaluator!, vars: this._vars },
      {
        reserved: ["frame", "name", "fn", "after"],
        sideValue: (p) => readInput(inputs[p] as (number | null)[] | undefined, this.literals[p] ?? 0),
        alias: this.bindings,
        rowRefs: wired
          ? (wired.expr ? rowRefNames(wired.expr).filter((p) => !(wired.captured ?? []).includes(p)) : [])
          : this._rowRefs,
      },
    );
    if (isSolError(computed)) { this._reconcileSideSockets([]); return out(computed); }
    this._reconcileSideSockets(computed.sideVars);
    const refused = wired
      ? readingsRefusal(bareLambdaCall(wired), f, this.bindings, new Map([["λ", wired]]))
      : readingsRefusal(this.expr, f, this.bindings);
    const values = refused ? computed.cells.map(() => refused) : computed.cells;
    const colType: FrameColType = this.addAs === "auto"
      ? computedColumnType(name, values, f, wired ? wired.expr : this.expr, this.bindings)
      : colTypeForAddAs(this.addAs);

    if (isCube) {
      const cubeOut = runVerb(() => cubeWithColumn(rawF as CubeValue, name, values, colType, after));
      return isSolError(cubeOut) ? out(cubeOut) : remember(cubeOut);
    }

    // Detect replacement by column count, which is exact and avoids repeating addColumn's `Name (unit)` parsing.
    const result = addColumn(f, name, values, colType);
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
    name: string; after: string; bindings: string; sideVals: unknown[];
  } | null = null;
}

// ─── GET ROW ────────────────────────────────────────────────────────────────────

export class GetRowNode extends ClassicPreset.Node {
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

  data(inputs: { frame?: unknown[]; index?: number[] }) {
    const raw = inputs.frame?.[0] ?? null;
    const idx1 = readInput(inputs.index, this.literals.index ?? 1);
    if (raw == null || idx1 === null) { this.cachedResult = null; return { frame: null }; }
    const i = Math.round(idx1) - 1;
    if (isCubeValue(raw)) {
      if (i < 0 || i >= cubeRowCount(raw)) { this.cachedResult = null; return { frame: null }; }
      const r = selectCubeRows(raw, [i]);
      this.cachedResult = r;
      return { frame: r };
    }
    const f = isFrameValue(raw) ? raw : widenToFrame(raw);
    if (i < 0 || i >= frameRowCount(f)) { this.cachedResult = null; return { frame: null }; }
    const columns: FrameColumn[] = f.columns.map((c) => ({
      ...c, values: [c.values[i] ?? null], raw: c.raw ? [c.raw[i] ?? ""] : undefined,
    }));
    this.cachedResult = { __frame: true, columns };
    return { frame: this.cachedResult };
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

  data(inputs: {
    frame?: unknown[]; lookup?: (string | string[])[];
    inColumn?: string[]; returnColumn?: string[]; ifNotFound?: string[];
  }) {
    const raw = inputs.frame?.[0] ?? null;
    const lookupRaw = readInput(inputs.lookup, this.stringLiterals.lookup ?? "");
    const inColRaw = readInput(inputs.inColumn, this.stringLiterals.inColumn ?? "");
    const retColRaw = readInput(inputs.returnColumn, this.stringLiterals.returnColumn ?? "");
    const fallbackRaw = readInput(inputs.ifNotFound, this.stringLiterals.ifNotFound ?? "");
    if (lookupRaw === null || inColRaw === null || retColRaw === null || fallbackRaw === null) {
      this.cachedResult = null; return { value: null };
    }
    const inCol = inColRaw.trim();
    const retCol = retColRaw.trim();
    const scalarLookupBlank = !Array.isArray(lookupRaw) && lookupRaw.trim() === "";
    if (raw == null || inCol === "" || retCol === "" || scalarLookupBlank) { this.cachedResult = null; return { value: null }; }
    const tabular = isFrameValue(raw) || isCubeValue(raw) || (Array.isArray(raw) && Array.isArray((raw as unknown[])[0]));
    if (!tabular) {
      this.cachedResult = solError("#VALUE!", "XLOOKUP needs a table or Cube. Combine two Lists with Frame from Lists first.");
      return { value: this.cachedResult };
    }
    const src = asLookupSource(raw)!;
    const srcCube = isCubeValue(src) ? src : frameToCube(src);
    const wholeRow = retCol === "*";
    const fb = fallbackRaw.trim();
    const matchOne = (lookupValue: unknown): CubeCell | null => {
      const lookup = lookupValue == null ? "" : String(lookupValue).trim();
      if (lookup === "") return null;
      let cell: CubeCell | undefined;
      if (wholeRow) {
        const idx = lookupRowIndex(srcCube, inCol, lookup, this.matchMode, this.searchMode);
        cell = idx < 0 ? undefined : (isCubeValue(src) ? cubeRowAt(src, idx) : frameRowAt(src, idx));
      } else {
        cell = lookupCell(srcCube, inCol, retCol, lookup, this.matchMode, this.searchMode);
      }
      if (cell !== undefined) return cell;
      if (fb === "") return solError("#N/A", "No row matched the lookup value");
      const num = Number(fb);
      return Number.isNaN(num) ? fb : num;
    };
    const result = runVerb<CubeCell | null>(() =>
      Array.isArray(lookupRaw) ? lookupRaw.map(matchOne) : matchOne(lookupRaw),
    );
    this.cachedResult = result;
    return { value: result };
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

  data(inputs: { frame?: (FrameValue | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = runVerb(() => describeFrame(f));
    return { frame: this.cachedResult };
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

  data(inputs: { frame?: (FrameValue | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = runVerb(() => correlationMatrix(f, this.method));
    return { frame: this.cachedResult };
  }
}

// ─── K-MEANS / PCA / LOGISTIC ─────────────────────────────────────────────────
import { kmeans, pca, logisticFit } from "./mlOps";

function numericRows(f: FrameValue): { names: string[]; rows: number[][]; kept: number[]; total: number } {
  const cols = f.columns.filter((c) => c.type === "number");
  const total = frameRowCount(f);
  const rows: number[][] = [], kept: number[] = [];
  for (let r = 0; r < total; r++) {
    const row = cols.map((c) => c.values[r]);
    if (row.every((v) => typeof v === "number" && Number.isFinite(v))) { rows.push(row as number[]); kept.push(r); }
  }
  return { names: cols.map((c) => c.name), rows, kept, total };
}

export class KMeansNode extends ClassicPreset.Node {
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

  data(inputs: { frame?: (FrameValue | null)[]; k?: number[] }) {
    const f = inputs.frame?.[0] ?? null;
    const k = readInput(inputs.k, this.literals.k ?? 3);
    const blank = () => { this.cachedLabels = null; this.cachedCenters = null; return { labels: null, centers: null }; };
    if (!f || k === null) return blank();
    const { names, rows, kept, total } = numericRows(f);
    if (names.length === 0) { const e = solError("#VALUE!", "K-Means needs at least one number column"); this.cachedLabels = e; this.cachedCenters = null; return { labels: e, centers: null }; }
    const r = kmeans(rows, k);
    if (!r) return blank();
    const labels: (number | null)[] = new Array(total).fill(null);
    kept.forEach((row, i) => { labels[row] = r.labels[i]; });
    const counts = r.centers.map((_, c) => r.labels.filter((l) => l === c + 1).length);
    this.cachedLabels = labels;
    this.cachedCenters = { __frame: true, columns: [
      { name: "Cluster", type: "number", values: r.centers.map((_, c) => c + 1) },
      ...names.map((nm, j) => ({ name: nm, type: "number" as const, values: r.centers.map((c) => c[j]) })),
      { name: "Count", type: "number", values: counts },
    ] };
    return { labels, centers: this.cachedCenters };
  }
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

  data(inputs: { frame?: (FrameValue | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    const blank = () => { this.cachedScores = null; this.cachedLoadings = null; this.cachedExplained = null; return { scores: null, loadings: null, explained: null }; };
    if (!f) return blank();
    const { names, rows, kept, total } = numericRows(f);
    if (names.length === 0) { const e = solError("#VALUE!", "PCA needs at least one number column"); this.cachedScores = e; this.cachedLoadings = null; this.cachedExplained = null; return { scores: e, loadings: null, explained: null }; }
    const r = pca(rows, { standardize: this.standardize });
    if (!r) return blank();
    const pcNames = names.map((_, c) => `PC${c + 1}`);
    const scores: FrameValue = { __frame: true, columns: pcNames.map((nm, c) => {
      const values: (number | null)[] = new Array(total).fill(null);
      kept.forEach((row, i) => { values[row] = r.scores[i][c]; });
      return { name: nm, type: "number" as const, values };
    }) };
    this.cachedScores = scores;
    this.cachedLoadings = { __frame: true, columns: [
      { name: "Feature", type: "string", values: names },
      ...pcNames.map((nm, c) => ({ name: nm, type: "number" as const, values: names.map((_, j) => r.loadings[j][c]) })),
    ] };
    this.cachedExplained = r.ratio;
    return { scores, loadings: this.cachedLoadings, explained: this.cachedExplained };
  }
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

  data(inputs: { frame?: (FrameValue | null)[]; target?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    const target = readInput(inputs.target, this.stringLiterals.target ?? "");
    const blank = (err: SolError | null = null) => { this.cachedCoefficients = err; this.cachedProbabilities = null; return { coefficients: err, probabilities: null }; };
    if (!f || target === null) return blank();
    const t = target.trim();
    if (t === "") return blank();
    const tcol = f.columns.find((c) => c.name === t);
    if (!tcol) return blank(solError("#REF!", `Logistic Regression: no column "${t}"`));
    const features = f.columns.filter((c) => c !== tcol && c.type === "number");
    if (features.length === 0) return blank(solError("#VALUE!", "Logistic Regression needs at least one number column besides the target"));
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
    if (!fit) return blank(solError("#DOMAIN!", "Logistic Regression: the target must take both values and there must be more rows than columns"));
    const terms = ["(Intercept)", ...features.map((c) => c.name)];
    this.cachedCoefficients = { __frame: true, columns: [
      { name: "Term", type: "string", values: terms },
      { name: "Coefficient", type: "number", values: fit.coefficients },
      { name: "Std Error", type: "number", values: fit.stdErrors },
      { name: "z", type: "number", values: fit.z },
      { name: "p", type: "number", values: fit.pValues },
    ] };
    const probs: (number | null)[] = new Array(total).fill(null);
    kept.forEach((row, i) => { probs[row] = fit.probabilities[i]; });
    this.cachedProbabilities = probs;
    return { coefficients: this.cachedCoefficients, probabilities: probs };
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
    const f = rowVerbInput(inputs.frame?.[0]);
    const keys = readColumnList(inputs.keys);
    const orderBy = readInput(inputs.orderBy, this.stringLiterals.orderBy ?? "");
    const column = readInput(inputs.column, this.stringLiterals.column ?? "");
    const name = readInput(inputs.name, this.stringLiterals.name ?? "");
    const n = readInput(inputs.n, this.literals.n ?? 3);
    if (f == null || keys === null || orderBy === null || column === null || name === null || n === null) return emitFrame(this, beginPass(this), null);
    if (WINDOW_FN_NEEDS_COLUMN.has(this.agg) && !column.trim()) {
      if (isCubeValue(f)) { this.cachedResult = f; return { frame: f }; }
      return emitFrame(this, beginPass(this), await passFrame(f));
    }
    const as = this.outColumnName(name, column);
    if (isCubeValue(f)) {
      const r = runVerb(() => windowCube(f, {
        partitionBy: keys, orderBy: orderBy.trim() || undefined, orderDir: "asc", fn: this.agg,
        column: column.trim() || undefined, as, n: WINDOW_FN_NEEDS_N.has(this.agg) ? n : undefined,
      }));
      this.cachedResult = r;
      return { frame: r };
    }
    return emitFrame(this, beginPass(this), await runFrameUnary(f, {
      kind: "window", partitionBy: keys, orderBy: orderBy.trim() || undefined, orderDir: "asc", fn: this.agg,
      column: column.trim() || undefined, as, n: WINDOW_FN_NEEDS_N.has(this.agg) ? n : undefined,
    }));
  }
}
