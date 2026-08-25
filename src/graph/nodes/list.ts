import { ClassicPreset } from "rete";
import { numListSocket, strListSocket, dateListSocket, logicalListSocket, comboOfType, comboOfFamily, type SocketDataType, type SolenoidSocket } from "../sockets";
import { parseListLiteral } from "../coerceInputs";
import { parseDate } from "./date";
import type { Cell as AnyCell } from "./coerce";
import { getRecalcGen } from "../process";
import { readInput, listIn, listOut, numIn, numOut, numListOut, logicalListIn, anyIn, anyComboIn, trueAnyIn, trueAnyOut, strIn, logicalOut, logicalListOut, frameIn, frameOut, anyListIn, adoptiveListIn, adoptiveListOut, tableOut } from "./shared";
import type { PassthroughSpec, ProjectContext } from "./passthrough";
import { pairIdsFromKeys, pickSlot } from "./logic";
import { passesFilter, VALUELESS_FILTER_OPS, type FilterOp, type FilterCondConfig } from "../frameVerbs";
import { solError, isSolError, type SolError } from "../errorValue";
import { forAggregate, isMissing, coerceLogical, type Tri } from "../valueKinds";
import { forAggregateUnits, tagDim, type UnitCell } from "../unitValue";
import { tagFrameCellUnit } from "../unitColumn";
import { stripUnitCells } from "../unitBridge";
import { type Dim, DIMENSIONLESS, dimPow, dimEqual, isDimensionless } from "../dimension";
import { iterMin, iterMax } from "./mathUtils";
import { aggregate, type AggregateOp } from "./statsOps";
import { MAX_GENERATED, sequenceList, shuffleList, setKey, uniqueList, sortNumericList, sortByKeys, setOperation, setRelation, fillList, rangeList, rangeCount, concatLists, reverseList, sliceList, nthElement, interleave, padList, diffList, normalizeList, shiftList, pctChangeList, zscoreList, binIndex, ntileList, outlierFlags, OUTLIER_DEFAULT_THRESHOLD, type OutlierMethod, spectrum, combinationsOf, gradientList, ewmaList, trapzList, convolveList, rleEncode, crossProduct, polyfitEval, running, type RunningOp, argMinMax, containsValue, xmatchIndex, type XMatchMatchMode, type XMatchSearchMode, weighted, linspace, repeatValue, geometric, fibonacci, type Cell as ListCell, argsortList, whichPositions, ARG_LIST_OPS } from "./listOps";
import { isFrameRef, flushRef, frameBackend, materialize } from "../frameBackend";
import { isFrameValue, isCubeValue, cubeRowCount, cubeFromColumns, frameRowCount, inferColumn, getColumn, type FrameValue, type FrameColumn, type CubeValue, type CubeCell, type FrameCell, type FrameColType } from "../frame";
import { indexInto, resolveAxes, indexRefError, type IndexAxis } from "./indexAccess";

// ─── List Input ─────────────────────────────────────────────────────────────

export type ListElemType = "number" | "string" | "date" | "logical";

const LIST_ELEM_SOCKET: Record<ListElemType, SolenoidSocket> = {
  number: numListSocket,
  string: strListSocket,
  date: dateListSocket,
  logical: logicalListSocket,
};

/** Delegates to the ONE typed-list literal parser, so a row parses identically in
 *  every SegToggle mode (RFC-4180 quoting; an unparseable part is `null`). */
function parseCsvList(dt: ListElemType, s: string | undefined): AnyCell[] {
  return s ? (parseListLiteral(s, LIST_ELEM_SOCKET[dt].dataType) as AnyCell[]) : [];
}

/** A wired element is CONVERTED to the row's type, never filtered — a wildcard source
 *  is accepted by every row socket but carries whatever flowed in. Null and per-cell
 *  SolErrors never reach here; the caller rides them through unchanged. */
function coerceElem(dt: ListElemType, v: unknown): AnyCell {
  switch (dt) {
    case "number": {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "string") { const n = Number(v.trim()); return v.trim() !== "" && Number.isFinite(n) ? n : null; }
      return null;
    }
    case "date": {
      // Dates ARE serials, so a number passes through; a string takes the row's parser.
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") {
        const d = parseDate(v);           // #AMBIGUOUS! surfaces (dateAmbiguitySurfaces)
        if (isSolError(d)) return d;
        return Number.isFinite(d) ? d : null;
      }
      return null;
    }
    case "string":
      // Stringifying IS the conversion — a wildcard of numbers yields ["1","2"], not [].
      if (typeof v === "string") return v;
      return typeof v === "number" || typeof v === "boolean" ? String(v) : null;
    case "logical":
      return coerceLogical(v);
  }
}

export class ListInputNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "Rows concatenate in order, and a wired row replaces its typed text.",
  };

  label: string;
  cachedList: AnyCell[] = [];
  dataType: ListElemType;
  // Each row is a comma-separated LIST; a wired list overrides its text and all rows
  // concatenate. Sparse: only rows with text or a cable contribute.
  stringLiterals: Record<string, string> = {};
  // `nextInputId` keeps extensible-row keys unique across removals.
  nextInputId = 0;
  width = 180;
  height = 200;

  /** The list socket for the current element type — new rows adopt it. */
  get valueSocket(): SolenoidSocket { return LIST_ELEM_SOCKET[this.dataType]; }

  constructor(init?: { label?: string; valueKeys?: string[]; dataType?: ListElemType }) {
    super("ListInput");
    this.label = init?.label ?? "List Input";
    this.dataType = init?.dataType ?? "number";
    // Load/paste must rebuild the EXACT keys or saved literals + cables misalign.
    if (init?.valueKeys?.length) {
      for (const k of init.valueKeys) this.addInputWithKey(k);
    } else {
      this.addValueInput();
    }
    this.addOutput("list", new ClassicPreset.Output(this.valueSocket, "List"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, new ClassicPreset.Input(this.valueSocket));
    const n = parseInt(key.replace(/^v/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  addValueInput(): string {
    const key = `v${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
    delete this.stringLiterals[key];
  }

  /** Re-types every row input + the output IN PLACE, which fires no connection event —
   *  the caller owes retypeOutputCables. False = unchanged, no-op. */
  setDataType(dt: ListElemType): boolean {
    if (this.dataType === dt) return false;
    this.dataType = dt;
    const sock = LIST_ELEM_SOCKET[dt];
    for (const key of Object.keys(this.inputs)) {
      const input = this.inputs[key];
      if (input) input.socket = sock;
    }
    const out = this.outputs.list;
    if (out) out.socket = sock;
    return true;
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const list: AnyCell[] = [];
    for (const key of Object.keys(this.inputs)) {
      // A CONNECTED cable wins even carrying `null`; a `wired != null` test would
      // resurrect the row's text for a wired MISSING.
      const slot = inputs[key];
      const wired = slot === undefined || slot.length === 0 ? undefined : (slot[0] ?? null);
      if (wired !== undefined) {
        const arr = Array.isArray(wired) ? wired : [wired];
        // Null and per-cell SolErrors ride through UNCHANGED — dropping them would
        // compact the list out of step with any parallel one.
        for (const v of arr) {
          list.push(v === null || isSolError(v) ? (v as AnyCell) : coerceElem(this.dataType, v));
        }
      } else {
        for (const v of parseCsvList(this.dataType, this.stringLiterals[key])) list.push(v);
      }
    }
    this.cachedList = list;
    return { list };
  }
}

// ─── Range ────────────────────────────────────────────────────────────────────

// ─── Series — ONE arithmetic-progression node (Range / SEQUENCE / LinSpace) ───
// Three parameterizations of the same progression: stop-bounded (Range),
// count-first (SEQUENCE), endpoint-count (LinSpace). Start is shared by all
// three and Step/Count by their pairs, so an op switch keeps those cables.

export type SeriesOp = "range" | "sequence" | "linspace" | "geometric" | "fibonacci" | "repeat";

export const SERIES_OP_META = {
  range:    { label: "Range",    description: "Generates a sequence from Start to Stop inclusive, Step apart. numpy arange stops before Stop; Excel's count-first equivalent is the Sequence op." },
  sequence: { label: "SEQUENCE", description: "List of N numbers starting at Start with Step between each. Like Range but count-first. Excel: SEQUENCE." },
  linspace: { label: "LinSpace", description: "Generates Count evenly spaced values from Start to End inclusive." },
  geometric: { label: "Geometric", description: "Geometric series: start × ratio^0, start × ratio^1, …" },
  fibonacci: { label: "Fibonacci", description: "First N Fibonacci numbers: 1, 1, 2, 3, 5, 8, …" },
  repeat:    { label: "Repeat",    description: "An array of one value repeated N times, like ZEROS or ONES." },
} satisfies Record<SeriesOp, { label: string; description: string }>;

const SERIES_SPECS: Record<SeriesOp, ReadonlyArray<{ key: string; label: string; def?: number }>> = {
  range:    [{ key: "start", label: "Start", def: 0 }, { key: "stop", label: "Stop" }, { key: "step", label: "Step", def: 1 }],
  sequence: [{ key: "count", label: "Count", def: 10 }, { key: "start", label: "Start (default 1)" }, { key: "step", label: "Step (default 1)" }],
  linspace: [{ key: "start", label: "Start", def: 0 }, { key: "end", label: "End", def: 1 }, { key: "count", label: "Count", def: 10 }],
  geometric: [{ key: "start", label: "Start", def: 1 }, { key: "ratio", label: "Ratio", def: 2 }, { key: "count", label: "Count", def: 8 }],
  fibonacci: [{ key: "count", label: "Count", def: 10 }],
  repeat:    [{ key: "value", label: "Value", def: 0 }, { key: "count", label: "Count", def: 5 }],
};

export class SeriesNode extends ClassicPreset.Node {
  label: string;
  op: SeriesOp;
  cachedList: number[] | SolError | null = [];
  literals: Record<string, number> = {};
  width = 180;
  height = 248;

  constructor(init?: { label?: string; op?: SeriesOp }) {
    super("Series");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "range";
    for (const i of SERIES_SPECS[this.op]) this.addInput(i.key, numIn(i.label));
    this.addOutput("list", listOut("List"));
    this.seedLiterals();
  }

  private seedLiterals(): void {
    // Only declared defaults seed: Range's Stop and SEQUENCE's Start/Step stay
    // unset, keeping their muted placeholders (and Range's empty-until-given
    // contract) across an op switch.
    for (const i of SERIES_SPECS[this.op]) if (i.def !== undefined) this.literals[i.key] ??= i.def;
  }

  /** The keys a switch to `next` would remove. Callers on a live graph prune
   *  these BEFORE calling setOp (onePrunePath). */
  keysDroppedBySwitch(next: SeriesOp): string[] {
    const keep = new Set(SERIES_SPECS[next].map((i) => i.key));
    return SERIES_SPECS[this.op].filter((i) => !keep.has(i.key)).map((i) => i.key);
  }

  setOp(next: SeriesOp): void {
    if (next === this.op) return;
    const before = SERIES_SPECS[this.op];
    this.op = next;
    const after = SERIES_SPECS[next];
    for (const i of before) if (!after.some((j) => j.key === i.key)) this.removeInput(i.key);
    for (const i of after) {
      const live = this.inputs[i.key];
      if (!live) this.addInput(i.key, numIn(i.label));
      else live.label = i.label; // a kept key keeps its cable; the label follows the op
    }
    this.seedLiterals();
  }

  data(inputs: { start?: number[]; stop?: number[]; step?: number[]; end?: number[]; count?: number[]; ratio?: number[]; value?: number[] }): { list: number[] | SolError | null } {
    let list: number[] | SolError | null;
    if (this.op === "range") {
      const start = readInput(inputs.start, this.literals.start ?? 0);
      // `stop` is legitimately UNSET: undefined is unset, null is a cable carrying blank.
      const stop  = readInput(inputs.stop, this.literals.stop as number | undefined);
      // A wired blank leaves the result unknown (value-semantics.md, "Reading an input").
      const step  = readInput(inputs.step, this.literals.step ?? 1);
      if (start === null || stop === null || step === null) list = null;
      else {
        // Generator convention: a non-terminating or over-ceiling range is a LOUD
        // error, never a silent truncation.
        const n = rangeCount(start, stop, step);
        if (!Number.isFinite(n)) list = solError("#DOMAIN!", "Step is 0 (or signed away from Stop), so the range never ends");
        else if (n > MAX_GENERATED) list = solError("#OVERFLOW!", `Range of ${Math.round(n)} elements exceeds the ${MAX_GENERATED} element limit`);
        else list = rangeList(start, stop, step);
      }
    } else if (this.op === "sequence") {
      const countRaw = readInput(inputs.count, this.literals.count ?? 10);
      const start = readInput(inputs.start, this.literals.start ?? 1);
      const step  = readInput(inputs.step, this.literals.step ?? 1);
      if (countRaw === null || start === null || step === null) list = null;
      else {
        const count = Math.max(0, Math.floor(countRaw));
        list = count > MAX_GENERATED
          ? solError("#OVERFLOW!", `SEQUENCE count ${count} exceeds the ${MAX_GENERATED} element limit`)
          : sequenceList(count, start, step);
      }
    } else if (this.op === "linspace") {
      const start = readInput(inputs.start, this.literals.start ?? 0);
      const end   = readInput(inputs.end, this.literals.end ?? 1);
      const nRaw  = readInput(inputs.count, this.literals.count ?? 10);
      list = start === null || end === null || nRaw === null ? null : linspace(start, end, nRaw);
    } else if (this.op === "geometric") {
      const start = readInput(inputs.start, this.literals.start ?? 1);
      const ratio = readInput(inputs.ratio, this.literals.ratio ?? 2);
      const nRaw  = readInput(inputs.count, this.literals.count ?? 8);
      if (start === null || ratio === null || nRaw === null) list = null;
      else list = Math.max(0, Math.round(nRaw)) > MAX_GENERATED
        ? solError("#OVERFLOW!", `Geometric count ${Math.round(nRaw)} exceeds the ${MAX_GENERATED} element limit`)
        : geometric(start, ratio, nRaw);
    } else if (this.op === "fibonacci") {
      // The kernel self-caps at 78 terms (F79 loses double precision), so no overflow guard.
      const nRaw = readInput(inputs.count, this.literals.count ?? 10);
      list = nRaw === null ? null : fibonacci(nRaw);
    } else {
      const v    = readInput(inputs.value, this.literals.value ?? 0);
      const nRaw = readInput(inputs.count, this.literals.count ?? 5);
      if (v === null || nRaw === null) list = null;
      else list = Math.max(0, Math.round(nRaw)) > MAX_GENERATED
        ? solError("#OVERFLOW!", `Repeat count ${Math.round(nRaw)} exceeds the ${MAX_GENERATED} element limit`)
        : repeatValue(v, nRaw);
    }
    this.cachedList = list;
    return { list };
  }
}

// ─── List ops: Length / Index / Sort / Reverse / Slice ─────────────────────────

export class ListLengthNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  width = 180;
  height = 120;

  constructor(init?: { label?: string }) {
    super("ListLength");
    this.label = init?.label ?? "LENGTH";
    this.addInput("list", anyListIn("List"));
    this.addOutput("result", numOut("Count"));
  }

  // `unknown[][]`, not `number[][]`: the socket is element-BLIND and this reads `.length`.
  data(inputs: { list?: unknown[][] }) {
    const arr = inputs.list?.[0] ?? null;
    this.cachedResult = arr ? arr.length : null;
    return { result: this.cachedResult };
  }
}

// INDEX reads a cell out of ANY container (list / matrix / frame / cube), so its
// input and output are `any`.
export class ListIndexNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    index: "Rows count from 1. 0 or unset takes every row. A wired blank blanks the result instead.",
    column: "Columns count from 1. 0 or unset takes every column. A plain list has only column 1.",
    result: "A whole row taken from a frame arrives as a one-row frame. A whole column arrives as a list.",
  };

  label: string;
  cachedResult: number | SolError | null | CubeCell | FrameValue | CubeValue = null;
  literals: Record<string, number> = {}; // 1-based (Excel INDEX); unset = [all]
  width = 180;
  height = 190;

  constructor(init?: { label?: string }) {
    super("ListIndex");
    this.label = init?.label ?? "INDEX";
    this.addInput("list",  trueAnyIn("Array")); // list, matrix, frame, or cube
    this.addInput("index", numIn("Row"));
    this.addInput("column", numIn("Column"));   // 2-D / frame / cube only
    // ADOPTIVE: the extracted value's ELEMENT FAMILY is the container's, so the
    // output adopts it — see the passthrough() note below for what stays unknowable.
    this.addOutput("result", trueAnyOut("Value"));
  }

  /** The passthrough declaration on `list` is what type adoption, unit flow, the
   *  display walk and the Conduit trace all read. `project` varies the RANK, not the
   *  family, so the result lands on the COMBO rung; a frame resolves per COLUMN. */
  passthrough(): PassthroughSpec[] {
    return [{
      output: "result",
      inputs: ["list"],
      combine: "single",
      project: (t, ctx) =>
        t === "frame" ? this.frameProjection(ctx)
        : t === "cube" ? this.cubeProjection(ctx)
        : comboOfType(t) ?? "trueany",
    }];
  }

  /** A cube's SLICES are always cubes, so any blank UNWIRED axis guarantees a cube;
   *  only a single CELL (both axes given) is unknowable and keeps the placeholder. */
  private cubeProjection(ctx: ProjectContext): SocketDataType {
    const blank = (key: "index" | "column") =>
      !ctx.wired(key) && (this.literals[key] == null || Math.round(this.literals[key]) === 0);
    return blank("index") || blank("column") ? "cube" : "trueany";
  }

  /** A frame carries no family on its socket, but its COLUMNS do, so the Column field
   *  resolves one off the static shape walk. Every arm mirrors `data()` below:
   *   • blank/0 Column  → the whole ROW: a one-row FRAME (or the container itself).
   *   • Column = c      → that column's family at the COMBO rung: the whole column for
   *                       a blank Row, one cell otherwise. */
  private frameProjection(ctx: ProjectContext): SocketDataType {
    // A WIRED Column is a runtime value this static walk can't know, so it counts as
    // unconfigured.
    if (ctx.wired("column")) return "trueany";
    const col = this.literals.column;
    if (col == null || Math.round(col) === 0) return "frame";
    const shape = ctx.shapeOf("list");
    // A DYNAMIC shape grows columns at compute time and shifts the ones after them, so
    // a POSITIONAL index into it isn't trustworthy.
    if (!shape || shape.dynamic) return "trueany";
    const c = shape.columns[Math.round(col) - 1]; // 1-based, Excel INDEX
    if (!c) return "trueany"; // out of range — a #REF! at runtime, no family to adopt
    return comboOfFamily(c.type) ?? "trueany";
  }

  data(inputs: { list?: unknown[]; index?: number[]; column?: number[] }): { result: IndexResult } {
    // Excel INDEX reads an OMITTED axis as the WHOLE axis — the unwired empty slot,
    // not a cable carrying blank.
    const rowIn = readInput(inputs.index, this.literals.index as number | undefined);
    const colIn = readInput(inputs.column, this.literals.column as number | undefined);
    const result = indexIntoContainer(inputs.list?.[0] ?? null, rowIn, colIn);
    this.cachedResult = result;
    return { result };
  }
}

type IndexResult = number | SolError | null | CubeCell | FrameValue | CubeValue;

/** INDEX over a frame or cube. Only the NODE can reach this — a formula holds
 *  neither (hideMatrixFromVendor) — so it rides here rather than in the shared accessor, which the
 *  formula path loads and must keep clear of the socket lattice (implReteFree). */
function indexIntoContainer(v: unknown, row: IndexAxis, col: IndexAxis): IndexResult {
  if (v === null || v === undefined) return null;
  if (!isFrameValue(v) && !isCubeValue(v)) {
    return indexInto(v, row, col, tagFrameCellUnit) as IndexResult;
  }
  const ax = resolveAxes(row, col);
  if (ax.blank) return null; // a WIRED blank axis
  const { rowAll, colAll, r, c } = ax;

  if (isCubeValue(v)) {
    if (rowAll && colAll) return v;
    const rows = cubeRowCount(v);
    if (!rowAll && (r < 0 || r >= rows)) return indexRefError(r + 1, rows, "Row");
    if (!colAll && (c < 0 || c >= v.columns.length)) return indexRefError(c + 1, v.columns.length, "Column");
    // Whole column / whole row stay CUBES so nested cells survive intact.
    if (rowAll) return cubeFromColumns([v.columns[c]]);
    if (colAll) return cubeFromColumns(v.columns.map((col) => ({ name: col.name, type: col.type, cells: [col.cells[r] ?? null] })));
    return v.columns[c].cells[r] ?? null;
  }

  if (rowAll && colAll) return v;
  const rows = frameRowCount(v);
  if (!rowAll && (r < 0 || r >= rows)) return indexRefError(r + 1, rows, "Row");
  if (!colAll && (c < 0 || c >= v.columns.length)) return indexRefError(c + 1, v.columns.length, "Column");
  // Whole column = the values list; a unit-locked column tags each cell so the
  // unit rides out of the frame.
  if (rowAll) {
    const col = v.columns[c];
    return (col.unit ? col.values.map((x) => tagFrameCellUnit(x, col.unit!)) : [...col.values]) as CubeCell;
  }
  if (colAll) {
    // Whole row = a ONE-ROW FRAME (Get Row / XLOOKUP `*` convention).
    const columns: FrameColumn[] = v.columns.map((col) => ({
      ...col, values: [col.values[r] ?? null], raw: col.raw ? [col.raw[r] ?? ""] : undefined,
    }));
    return { __frame: true, columns };
  }
  // A single cell from a unit-locked column carries the column's unit.
  const cell = v.columns[c].values[r] ?? null;
  return v.columns[c].unit ? (tagFrameCellUnit(cell, v.columns[c].unit!) as CubeCell) : cell;
}

export type SortDir = "asc" | "desc";

export class SortNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    by: "Optional. Unwired, the list sorts by its own values. Wired, it sorts by this parallel numeric key list (sort names by their scores); position-only, so any element type reorders. A blank or error key sends its element to the end; a length mismatch errors the result.",
    result: "Blank and error cells sort to the end in either direction.",
  };

  /** The output adopts the sorted list's type; the `by` keys are a side input and stay
   *  unit-blind (like SORTBY, which this node absorbed). */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  op: SortDir;
  cachedList: (number | string | boolean | null | SolError)[] | SolError | null = [];
  width = 180;
  height = 175;

  constructor(init?: { label?: string; op?: SortDir }) {
    super("Sort");
    this.label = init?.label ?? "List Sort";
    this.op = init?.op ?? "asc";
    // Widened to anylist so a wired `by` can reorder ANY element family, not just numbers.
    this.addInput("list", anyListIn("List"));
    this.addInput("by",   listIn("Sort by"));
    this.addOutput("result", adoptiveListOut("Sorted"));
  }

  data(inputs: { list?: unknown[][]; by?: ((number | null | SolError)[] | null)[] }): { result: (number | string | boolean | null | SolError)[] | SolError | null } {
    const arr = inputs.list?.[0] ?? [];
    const desc = this.op === "desc";
    const by = inputs.by?.[0];
    if (Array.isArray(by)) {
      // Wired parallel keys (SORTBY): reorder `arr` by them. Same length required.
      if (by.length !== arr.length) {
        this.cachedList = solError("#SHAPE!", `The sort-by list has ${by.length} values but the list has ${arr.length}`);
        return { result: this.cachedList };
      }
      this.cachedList = sortByKeys(arr, by, desc) as (number | string | boolean | null | SolError)[];
      return { result: this.cachedList };
    }
    // A wired-blank `by` leaves the result unknown (value-semantics.md, role table);
    // an UNWIRED `by` self-sorts the list by its own (numeric) values — the classic Sort.
    if ("by" in inputs) { this.cachedList = null; return { result: null }; }
    this.cachedList = sortNumericList(arr as ListCell[], desc) as (number | null | SolError)[];
    return { result: this.cachedList };
  }
}

// Position-only utilities ride element-agnostic `anylist` sockets (appendLadder); ops needing
// comparison or arithmetic semantics (Sort, Cumulative) stay typed.
export class ReverseNode extends ClassicPreset.Node {
  /** Element-preserving: the output adopts the input\'s type (passthrough.ts). */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  cachedList: unknown[] = [];
  width = 180;
  height = 120;

  constructor(init?: { label?: string }) {
    super("Reverse");
    this.label = init?.label ?? "REVERSE";
    this.addInput("list", adoptiveListIn("List"));
    this.addOutput("result", adoptiveListOut("Reversed"));
  }

  data(inputs: { list?: unknown[][] }) {
    const arr = inputs.list?.[0] ?? [];
    const reversed = reverseList(arr);
    this.cachedList = reversed;
    return { result: reversed };
  }
}

export class ShiftNode extends ClassicPreset.Node {
  /** Element-preserving: the output adopts the input's type. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  literals: Record<string, number> = { by: 1 };
  /** Vacated slots: blank (drop off the end) or wrap around (numpy.roll). */
  wrap: "blank" | "wrap" = "blank";
  cachedList: unknown[] = [];
  width = 180; height = 150;

  constructor(init?: { label?: string; wrap?: "blank" | "wrap" }) {
    super("Shift");
    this.label = init?.label ?? "Shift";
    if (init?.wrap) this.wrap = init.wrap;
    this.addInput("list", adoptiveListIn("List"));
    this.addInput("by", numIn("By"));
    this.addOutput("result", adoptiveListOut("Shifted"));
  }

  data(inputs: { list?: unknown[][]; by?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    const by = readInput(inputs.by, this.literals.by ?? 1);
    if (by === null) { this.cachedList = []; return { result: [] }; }
    this.cachedList = shiftList(arr as ListCell[], by, this.wrap === "wrap");
    return { result: this.cachedList };
  }
}

export type BinMode = "breaks" | "quantiles";
export const BIN_MODE_OPTIONS: ReadonlyArray<{ value: BinMode; label: string; title: string }> = [
  { value: "breaks",    label: "breaks",    title: "Bin by the wired breakpoints: 0 below the first edge, up to n above the last (numpy digitize, R findInterval)" },
  { value: "quantiles", label: "quantiles", title: "Bin into n equal-count buckets 1..n (dplyr ntile, pandas qcut)" },
];

export class BinNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    breaks: "The bin edges. A value is placed by how many edges it clears: 0 below the first edge, up to n above the last.",
    n: "How many equal-count buckets; the result is the bucket number, 1 to n.",
  };
  label: string;
  /** Breakpoint bins (digitize) or quantile buckets (ntile) — the mode owns the second socket. */
  mode: BinMode = "breaks";
  literals: Record<string, number> = { n: 4 };
  cachedList: ListCell[] | SolError = [];
  width = 180; height = 180;

  constructor(init?: { label?: string; mode?: BinMode }) {
    super("Bin");
    this.label = init?.label ?? "Bin";
    if (init?.mode) this.mode = init.mode;
    this.addInput("list", listIn("List"));
    if (this.mode === "quantiles") this.addInput("n", numIn("Buckets"));
    else this.addInput("breaks", listIn("Breaks"));
    this.addOutput("result", listOut(this.mode === "quantiles" ? "Bucket" : "Bin index"));
  }

  /** The mode owns the second socket (Breaks ↔ Buckets). Callers on a live graph prune
   *  the departing socket's cables BEFORE switching (onePrunePath). */
  setMode(next: BinMode): void {
    if (next === this.mode) return;
    this.mode = next;
    if (next === "quantiles") { if (this.inputs.breaks) this.removeInput("breaks"); if (!this.inputs.n) this.addInput("n", numIn("Buckets")); }
    else { if (this.inputs.n) this.removeInput("n"); if (!this.inputs.breaks) this.addInput("breaks", listIn("Breaks")); }
    const out = this.outputs.result;
    if (out) out.label = next === "quantiles" ? "Bucket" : "Bin index";
  }

  data(inputs: { list?: ListCell[][]; breaks?: ListCell[][]; n?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    if (this.mode === "quantiles") {
      const n = readInput(inputs.n, this.literals.n ?? 4);
      this.cachedList = n === null ? [] : ntileList(arr, n);
    } else {
      this.cachedList = binIndex(arr, inputs.breaks?.[0] ?? []);
    }
    return { result: this.cachedList };
  }
}

export type { OutlierMethod } from "./listOps";
export const OUTLIER_METHOD_META = {
  z:   { label: "z-score", description: "|z| above the threshold (default 3): distance from the mean in sample standard deviations." },
  iqr: { label: "IQR",     description: "Beyond Q1 − k·IQR or Q3 + k·IQR (default k = 1.5): the boxplot whisker rule. R boxplot.stats." },
  mad: { label: "MAD",     description: "Modified z-score 0.6745·(x − median)/MAD above the threshold (default 3.5): the robust Iglewicz–Hoaglin rule." },
} satisfies Record<OutlierMethod, { label: string; description: string }>;

export class OutliersNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "One row per input value: Value (the list with outliers blanked, so aggregates skip them and positions hold) and Outlier, TRUE where the rule flags it, though a blank stays blank.",
    threshold: "Leave unwired for the rule's conventional cutoff: 3 for z, 1.5 for IQR, 3.5 for MAD.",
  };
  label: string;
  method: OutlierMethod = "z";
  literals: Record<string, number> = {};
  cachedResult: FrameValue | null = null;
  width = 190; height = 200;

  constructor(init?: { label?: string; method?: OutlierMethod }) {
    super("Outliers");
    this.label = init?.label ?? "Outliers";
    if (init?.method) this.method = init.method;
    this.addInput("list", listIn("List"));
    this.addInput("threshold", numIn("Threshold"));
    // Value + Outlier are index-aligned, so they leave as ONE frame (C5). Value keeps the
    // input's element family (inferColumn); Outlier is logical.
    this.addOutput("result", frameOut("Result"));
  }

  data(inputs: { list?: ListCell[][]; threshold?: number[] }): { result: FrameValue | null } {
    const arr = inputs.list?.[0] ?? null;
    const t = readInput(inputs.threshold, this.literals.threshold ?? OUTLIER_DEFAULT_THRESHOLD[this.method]);
    if (arr === null || t === null) { this.cachedResult = null; return { result: null }; }
    const flags = outlierFlags(arr, this.method, t);
    const clean = arr.map((v, i) => (flags[i] === true ? null : v));
    const frame: FrameValue = {
      __frame: true,
      columns: [
        inferColumn("Value", clean),
        { name: "Outlier", type: "logical", values: flags },
      ],
    };
    this.cachedResult = frame;
    return { result: frame };
  }
}

export class CombinationsNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "One row per combination (or permutation). Empty when k is larger than the list.",
  };
  label: string;
  literals: Record<string, number> = { k: 2 };
  /** Order-independent subsets (itertools.combinations) or ordered arrangements (permutations). */
  mode: "combinations" | "permutations" = "combinations";
  cachedResult: ListCell[][] | SolError | null = null;
  width = 200; height = 210;

  constructor(init?: { label?: string; mode?: "combinations" | "permutations" }) {
    super("Combinations");
    this.label = init?.label ?? "Combinations";
    if (init?.mode) this.mode = init.mode;
    this.addInput("list", listIn("List"));
    this.addInput("k", numIn("Choose k"));
    this.addOutput("result", tableOut("Rows"));
  }

  data(inputs: { list?: unknown[][]; k?: number[] }) {
    const arr = (inputs.list?.[0] ?? []) as ListCell[];
    const k = readInput(inputs.k, this.literals.k ?? 2);
    if (k === null || arr.length === 0) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = combinationsOf(arr, k, this.mode);
    return { result: this.cachedResult };
  }
}

export class EwmaNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    alpha: "Smoothing factor 0–1: higher tracks recent values closely, lower smooths harder.",
  };
  label: string;
  literals: Record<string, number> = { alpha: 0.3 };
  cachedList: ListCell[] | SolError = [];
  width = 180; height = 150;

  constructor(init?: { label?: string }) {
    super("Ewma");
    this.label = init?.label ?? "EWMA";
    this.addInput("list", listIn("List"));
    this.addInput("alpha", numIn("Alpha"));
    this.addOutput("result", listOut("Smoothed"));
  }

  data(inputs: { list?: ListCell[][]; alpha?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    const alpha = readInput(inputs.alpha, this.literals.alpha ?? 0.3);
    if (alpha === null) { this.cachedList = []; return { result: [] }; }
    this.cachedList = ewmaList(arr, alpha);
    return { result: this.cachedList };
  }
}

export class ConvolveNode extends ClassicPreset.Node {
  label: string;
  cachedList: ListCell[] | SolError = [];
  width = 180; height = 150;

  constructor(init?: { label?: string }) {
    super("Convolve");
    this.label = init?.label ?? "Convolve";
    this.addInput("a", listIn("A"));
    this.addInput("b", listIn("B"));
    this.addOutput("result", listOut("A ∗ B"));
  }

  data(inputs: { a?: ListCell[][]; b?: ListCell[][] }) {
    this.cachedList = convolveList(inputs.a?.[0] ?? [], inputs.b?.[0] ?? []);
    return { result: this.cachedList };
  }
}

export class CrossNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "The vector perpendicular to both inputs. Each operand must be three numbers.",
  };
  label: string;
  cachedList: ListCell[] | SolError = [];
  width = 180; height = 150;

  constructor(init?: { label?: string }) {
    super("Cross");
    this.label = init?.label ?? "Cross Product";
    this.addInput("a", listIn("A"));
    this.addInput("b", listIn("B"));
    this.addOutput("result", listOut("A × B"));
  }

  data(inputs: { a?: ListCell[][]; b?: ListCell[][] }) {
    this.cachedList = crossProduct(inputs.a?.[0] ?? [], inputs.b?.[0] ?? []);
    return { result: this.cachedList };
  }
}

export class PolyfitNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "The fitted y value at each input x: the least-squares polynomial of the chosen degree, evaluated back over the data.",
  };
  label: string;
  literals: Record<string, number> = { degree: 2 };
  cachedList: ListCell[] | SolError = [];
  width = 200; height = 180;

  constructor(init?: { label?: string }) {
    super("Polyfit");
    this.label = init?.label ?? "Poly Fit";
    this.addInput("x", listIn("x"));
    this.addInput("y", listIn("y"));
    this.addInput("degree", numIn("Degree"));
    this.addOutput("result", listOut("Fitted y"));
  }

  data(inputs: { x?: ListCell[][]; y?: ListCell[][]; degree?: number[] }) {
    const degree = readInput(inputs.degree, this.literals.degree ?? 2);
    if (degree === null) { this.cachedList = []; return { result: [] }; }
    this.cachedList = polyfitEval(inputs.x?.[0] ?? [], inputs.y?.[0] ?? [], degree);
    return { result: this.cachedList };
  }
}

export class TrapzNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "The area under the piecewise-linear curve through the points, at uniform spacing dx.",
  };
  label: string;
  literals: Record<string, number> = { dx: 1 };
  cachedResult: number | ListCell | null = null;
  width = 180; height = 150;

  constructor(init?: { label?: string }) {
    super("Trapz");
    this.label = init?.label ?? "Integrate";
    this.addInput("list", listIn("List"));
    this.addInput("dx", numIn("dx"));
    this.addOutput("result", numOut("Area"));
  }

  data(inputs: { list?: ListCell[][]; dx?: number[] }) {
    const dx = readInput(inputs.dx, this.literals.dx ?? 1);
    if (dx === null) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = trapzList(inputs.list?.[0] ?? [], dx);
    return { result: this.cachedResult };
  }
}

export class RleNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Two columns: each consecutive run's value and its length. R rle.",
  };
  label: string;
  cachedResult: ListCell[][] | null = null;
  width = 180; height = 150;

  constructor(init?: { label?: string }) {
    super("Rle");
    this.label = init?.label ?? "Run Lengths";
    this.addInput("list", listIn("List"));
    this.addOutput("result", tableOut("value, count"));
  }

  data(inputs: { list?: ListCell[][] }) {
    const arr = inputs.list?.[0] ?? [];
    this.cachedResult = arr.length === 0 ? null : rleEncode(arr);
    return { result: this.cachedResult };
  }
}

export class SliceNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    end: "The element at End is included. Left unset, the slice runs to the end of the list.",
  };

  /** Element-preserving: the output adopts the input\'s type (passthrough.ts). */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  cachedList: unknown[] | null = [];
  // 1-based, inclusive. `end` unset → through the end of the list.
  literals: Record<string, number> = { start: 1 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("Slice");
    this.label = init?.label ?? "SLICE";
    this.addInput("list",  adoptiveListIn("List"));
    this.addInput("start", numIn("Start"));
    this.addInput("end",   numIn("End"));
    this.addOutput("result", adoptiveListOut("Slice"));
  }

  data(inputs: { list?: unknown[][]; start?: number[]; end?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    const startRaw = readInput(inputs.start, this.literals.start ?? 1);
    // An UNSET end means "to the end of the list"; a WIRED blank does not.
    // A wired blank leaves the result unknown (value-semantics.md, "Reading an input").
    const endRaw = readInput(inputs.end, this.literals.end as number | undefined);
    if (startRaw === null || endRaw === null) { this.cachedList = null; return { result: null }; }
    const sliced = sliceList(arr, startRaw, endRaw);
    this.cachedList = sliced;
    return { result: sliced };
  }
}

// ─── Filter ────────────────────────────────────────────────────────────────────
// A list tested against ITS OWN values (filterOneJob) — deliberately no table input and no
// "Keep if" mask. Kept ∪ Dropped stays the exhaustive complement.

/** Re-export so the barrel keeps one FilterCombine (the frame Filter's). */
export type { FilterCombine } from "../frameVerbs";
import type { FilterCombine } from "../frameVerbs";

/** The element family driving passesFilter's comparison semantics. Dates are
 *  serials, so they compare as numbers; blanks/errors don't vote. */
function listElemColType(arr: readonly unknown[]): FrameColType {
  for (const v of arr) {
    if (v == null || isSolError(v)) continue;
    if (typeof v === "string") return "string";
    if (typeof v === "boolean") return "logical";
    if (typeof v === "number") return "number";
  }
  return "number";
}

/** Null for a WIRED blank (the comparison value is UNKNOWN, unlike the empty
 *  literal's "not written yet"); a wired scalar stringifies so both engines see
 *  what a typed literal would say. */
export function readFilterValue(wired: unknown[] | undefined, literal: string | undefined): string | null {
  const raw: unknown = wired === undefined || wired.length === 0 ? (literal ?? "") : (wired[0] ?? null);
  if (raw === null) return null;
  if (isSolError(raw)) return raw.code;
  return String(raw);
}

export class FilterNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "With no completed condition the whole list passes through unchanged.",
  };

  label: string;
  combine: FilterCombine;
  /** Per-row {op, matchCase}, keyed by the row id (the `value${id}` suffix). */
  condConfig: Record<string, FilterCondConfig> = {};
  stringLiterals: Record<string, string> = {};
  nextCondId = 0;
  cachedResult: unknown[] | null = null;
  cachedDropped: unknown[] | null = null;
  width = 200;
  height = 240;

  constructor(init?: {
    label?: string;
    // Old saves carried "none" (single-condition mode) — it folds to "and".
    combine?: FilterCombine | "none";
    condConfig?: Record<string, FilterCondConfig>;
    valueKeys?: string[];
  }) {
    super("Filter");
    this.label = init?.label ?? "List Filter";
    this.combine = init?.combine === "or" ? "or" : "and";
    this.addInput("list", anyListIn("List"));
    const ids = pairIdsFromKeys(init?.valueKeys?.filter((k) => k.startsWith("value")), "value");
    if (ids.length) {
      for (const id of ids) this.addCondWithId(id);
      for (const id of ids) {
        const cfg = init?.condConfig?.[String(id)];
        if (cfg) this.condConfig[String(id)] = { ...cfg };
      }
    } else {
      this.addValueInput();
    }
    this.addOutput("result", adoptiveListOut("Kept"));
    this.addOutput("dropped", adoptiveListOut("Dropped"));
  }

  /** Element-preserving: both outputs adopt the wired input's concrete type, so a
   *  typed consumer still connects. */
  passthrough = (): PassthroughSpec[] => [
    { output: "result", inputs: ["list"], combine: "single" },
    { output: "dropped", inputs: ["list"], combine: "single" },
  ];

  private addCondWithId(id: number): void {
    // `any` scalar: any wired threshold connects; unwired, the typed field is the
    // literal, parsed per the list's type.
    this.addInput(`value${id}`, anyIn(`Value ${id + 1}`));
    if (!this.condConfig[String(id)]) this.condConfig[String(id)] = { op: "gt" };
    this.nextCondId = Math.max(this.nextCondId, id + 1);
  }

  /** Ordered condition-row keys (insertion order). */
  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("value"));
  }

  addValueInput(): string {
    const key = `value${this.nextCondId}`;
    this.addCondWithId(this.nextCondId);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
    delete this.stringLiterals[key];
    // condConfig entry stays for row-removal undo; reload prunes orphans.
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown[] | null; dropped: unknown[] | null } {
    const arr = inputs.list?.[0] as unknown[] | null | undefined;
    if (arr == null) {
      this.cachedResult = null;
      this.cachedDropped = null;
      return { result: null, dropped: null };
    }
    // Tags arrive intact (passthrough), so predicate + type detection run on unwrapped
    // magnitudes while the OUTPUTS keep the original cells and stay dimensioned.
    const mags = arr.map(stripUnitCells);
    const type = listElemColType(mags);
    const conds: { op: FilterOp; value: string; matchCase: boolean }[] = [];
    for (const key of this.valueInputKeys()) {
      const id = key.slice(5);
      const cfg = this.condConfig[id];
      const op: FilterOp = cfg?.op ?? "gt";
      const val = readFilterValue(inputs[key], this.stringLiterals[key]);
      // The blank / error predicates take no value — an empty field doesn't mean
      // "not written yet" for them, it's the whole point.
      const valueless = VALUELESS_FILTER_OPS.has(op);
      // A WIRED blank comparison value is unevaluable → blank result, not the
      // unfiltered list; the EMPTY literal still just skips the condition.
      if (!valueless && val === null) {
        this.cachedResult = null; this.cachedDropped = null;
        return { result: null, dropped: null };
      }
      if (!valueless && val!.trim() === "") continue; // "not written yet" — excluded (frame-Filter parity)
      conds.push({ op, value: val!, matchCase: cfg?.matchCase ?? false });
    }
    if (conds.length === 0) {
      // No complete conditions = pass-through, like the frame Filter.
      this.cachedResult = [...arr];
      this.cachedDropped = null;
      return { result: this.cachedResult, dropped: null };
    }
    const kept: unknown[] = [];
    const dropped: unknown[] = [];
    for (let i = 0; i < arr.length; i++) {
      const mag = mags[i] as FrameCell; // unwrapped magnitude for the predicate
      const pass = (c: { op: FilterOp; value: string; matchCase: boolean }) =>
        passesFilter(mag, c.op, c.value, type, c.matchCase);
      if (this.combine === "and" ? conds.every(pass) : conds.some(pass)) kept.push(arr[i]);
      else dropped.push(arr[i]); // incl. null/error cells — the split is exhaustive
    }
    this.cachedResult = kept;
    this.cachedDropped = dropped;
    return { result: kept, dropped };
  }
}

// ─── SUMIFS / COUNTIFS / AVERAGEIFS / MINIFS / MAXIFS ─────────────────────────
// Conditional aggregation over ONE FRAME, AND-only like Excel's *IFS: position-
// aligned columns arrive as a frame, never as parallel list sockets (filterOneJob).

export type CondAggOp = "sumifs" | "countifs" | "averageifs" | "minifs" | "maxifs";

export const COND_AGG_OP_META = {
  sumifs:     { label: "SUMIFS",     description: "Sum the Values column over the rows where every criteria row passes. Excel: SUMIFS / SUMIF." },
  countifs:   { label: "COUNTIFS",   description: "Count the rows where every criteria row passes (needs no Values column). Excel: COUNTIFS / COUNTIF." },
  averageifs: { label: "AVERAGEIFS", description: "Average the Values column where every criteria row passes. Nothing matching is #DIV/0! like Excel. Excel: AVERAGEIFS / AVERAGEIF." },
  minifs:     { label: "MINIFS",     description: "Smallest Values-column cell where every criteria row passes. Nothing matching is 0 like Excel. Excel: MINIFS." },
  maxifs:     { label: "MAXIFS",     description: "Largest Values-column cell where every criteria row passes. Nothing matching is 0 like Excel. Excel: MAXIFS." },
} satisfies Record<CondAggOp, { label: string; description: string }>;

export class SumIfsNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "Names the column to aggregate. COUNTIFS counts rows and ignores it.",
  };

  label: string;
  op: CondAggOp;
  /** Combine the criteria rows: ALL must pass (Excel SUMIFS), or ANY one. */
  match: "all" | "any" = "all";
  /** Per-pair {op, matchCase}, keyed by the pair id (the `column${id}` suffix). */
  condConfig: Record<string, FilterCondConfig> = {};
  stringLiterals: Record<string, string> = {};
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["Column", "Value"];
  cachedResult: number | UnitCell | SolError | null = null;
  width = 210;
  height = 280;

  constructor(init?: {
    label?: string; op?: CondAggOp; match?: "all" | "any";
    condConfig?: Record<string, FilterCondConfig>; valueKeys?: string[];
  }) {
    super("SumIfs");
    this.op = init?.op ?? "sumifs";
    if (init?.match === "all" || init?.match === "any") this.match = init.match;
    this.label = init?.label ?? "";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("values", strIn("Values column"));
    const ids = pairIdsFromKeys(init?.valueKeys, "column");
    if (ids.length) {
      for (const id of ids) this.addPairWithId(id);
      for (const id of ids) {
        const cfg = init?.condConfig?.[String(id)];
        if (cfg) this.condConfig[String(id)] = { ...cfg };
      }
    } else {
      this.addValuePair();
    }
    this.addOutput("result", numOut("Result"));
  }

  private addPairWithId(id: number): void {
    this.addInput(`column${id}`, strIn(`Column ${id + 1}`));
    // `any` (scalar): a wired threshold connects; unwired, the typed text field
    // is the literal (parsed per the column type) — same row as the frame Filter.
    this.addInput(`value${id}`, anyIn(`Value ${id + 1}`));
    if (!this.condConfig[String(id)]) this.condConfig[String(id)] = { op: "eq" };
    this.nextPairId = Math.max(this.nextPairId, id + 1);
  }

  /** Ordered (columnKey, valueKey) pairs currently present, in insertion order. */
  valuePairKeys(): Array<[string, string]> {
    return Object.keys(this.inputs)
      .filter((k) => k.startsWith("column"))
      .map((k) => { const id = k.slice(6); return [`column${id}`, `value${id}`] as [string, string]; });
  }

  addValuePair(): void {
    this.addPairWithId(this.nextPairId);
  }

  removeValuePair(colKey: string): void {
    const id = colKey.slice(6);
    this.removeInput(`column${id}`);
    this.removeInput(`value${id}`);
    delete this.stringLiterals[`column${id}`];
    delete this.stringLiterals[`value${id}`];
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | UnitCell | SolError | null } {
    const finish = (r: number | UnitCell | SolError | null) => { this.cachedResult = r; return { result: r }; };
    const raw = inputs.frame?.[0];
    // A lazy upstream: fetch ONLY the named columns, then run on that slice.
    if (isFrameRef(raw)) {
      const names = new Set<string>();
      for (const [colKey] of this.valuePairKeys()) {
        const n = readInput(inputs[colKey] as string[] | undefined, this.stringLiterals[colKey] ?? "");
        if (n != null && String(n).trim() !== "") names.add(String(n).trim());
      }
      const vn = readInput(inputs.values as string[] | undefined, this.stringLiterals.values ?? "");
      if (vn != null && String(vn).trim() !== "") names.add(String(vn).trim());
      return (async () => {
        const cols = await materialize((async () => {
          const h = await flushRef(raw);
          return Promise.all([...names].map((n) => frameBackend().column(h, n)));
        })());
        if (isSolError(cols)) return finish(cols);
        const slice: FrameValue = { __frame: true, columns: cols.filter((c): c is FrameColumn => c != null) };
        return this.data({ ...inputs, frame: [slice] });
      })() as unknown as { result: number | UnitCell | SolError | null };
    }
    const f = raw as FrameValue | null | undefined;
    if (!isFrameValue(f)) return finish(null);
    interface Crit { col: FrameColumn; op: FilterOp; value: string; matchCase: boolean }
    const crits: Crit[] = [];
    for (const [colKey, valKey] of this.valuePairKeys()) {
      const id = colKey.slice(6);
      const nameRaw = readInput(inputs[colKey] as string[] | undefined, this.stringLiterals[colKey] ?? "");
      const cfg = this.condConfig[id];
      const op: FilterOp = cfg?.op ?? "eq";
      const val = readFilterValue(inputs[valKey], this.stringLiterals[valKey]);
      const valueless = op === "isblank" || op === "notblank"; // no value to write
      // A WIRED blank column or value is unevaluable, so the aggregate is unknown.
      if (nameRaw === null || (!valueless && val === null)) return finish(null);
      const name = String(nameRaw).trim();
      if (name === "" || (!valueless && val!.trim() === "")) continue; // row not written yet
      const col = getColumn(f, name);
      if (!col) return finish(solError("#REF!", `No column "${name}" in the frame`));
      crits.push({ col, op, value: val!, matchCase: cfg?.matchCase ?? false });
    }
    if (crits.length === 0) return finish(null);
    const n = frameRowCount(f);
    const test = (c: Crit, i: number) =>
      passesFilter((c.col.values[i] ?? null) as FrameCell, c.op, c.value, c.col.type, c.matchCase);
    // ALL criteria must pass (Excel SUMIFS), or ANY one — the match selector picks.
    const passes = (i: number) =>
      this.match === "any" ? crits.some((c) => test(c, i)) : crits.every((c) => test(c, i));
    // COUNTIFS takes no values range (Excel); the others need the column named.
    if (this.op === "countifs") {
      let count = 0;
      for (let i = 0; i < n; i++) if (passes(i)) count++;
      return finish(count);
    }
    const vnameRaw = readInput(inputs.values as string[] | undefined, this.stringLiterals.values ?? "");
    // A wired blank names no column — unknown (value-semantics.md, "Reading an input").
    if (vnameRaw === null) return finish(null);
    const vname = String(vnameRaw).trim();
    if (vname === "") return finish(null); // not written yet
    const vcol = getColumn(f, vname);
    if (!vcol) return finish(solError("#REF!", `No column "${vname}" in the frame`));
    const kept: unknown[] = [];
    for (let i = 0; i < n; i++) if (passes(i)) kept.push(vcol.values[i] ?? null);
    const prep = forAggregate(kept);
    if (prep.error) return finish(prep.error);
    const nums = prep.nums;
    // sum/avg/min/max all preserve a locked column's dimension, so the result re-tags.
    const dim: Dim = vcol.unit ? vcol.unit.dim : DIMENSIONLESS;
    const tag = (n: number): number | UnitCell => (isDimensionless(dim) ? n : tagDim(n, dim));
    switch (this.op) {
      case "sumifs":     return finish(tag(nums.reduce((a, b) => a + b, 0)));
      case "averageifs": return finish(nums.length ? tag(nums.reduce((a, b) => a + b, 0) / nums.length) : solError("#DIV/0!", "No rows matched the criteria"));
      case "minifs":     return finish(nums.length ? tag(iterMin(nums)) : 0); // Excel: empty match → 0
      case "maxifs":     return finish(nums.length ? tag(iterMax(nums)) : 0);
    }
  }
}

// ─── Array operation nodes ────────────────────────────────────────────────────

export class UniqueNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  width = 180;
  height = 120;

  constructor(init?: { label?: string }) {
    super("Unique");
    this.label = init?.label ?? "UNIQUE";
    this.addInput("list",   listIn("List"));
    this.addOutput("result", listOut("Unique"));
  }

  data(inputs: { list?: number[][] }) {
    const arr = (inputs.list?.[0] ?? []) as unknown[];
    // First-seen dedupe by VALUE (setKey), every error cell surviving deterministically.
    this.cachedList = uniqueList(arr) as number[];
    return { result: this.cachedList };
  }
}

export type SetOp = "union" | "intersect" | "difference" | "symdiff";

// Membership must key by VALUE: a complex is a tagged OBJECT, and a JS Set keys
// objects by REFERENCE, so two equal complexes would never match.

// label = the op's bare name (a card title / search row); the membership hint rides in
// `description`, which the dropdown shows as the option tooltip. tex / plain = KaTeX
// notation + Unicode fallback. `fx` is declared per op because a bare name doesn't
// despace to the SET* function name (formulaNaming's "label despaced" rule).
export const SET_OP_META: Record<SetOp, { label: string; description: string; fx: string; tex: string; plain: string }> = {
  union:      { label: "Union",                fx: "SETUNION",      description: "In A or B",         tex: "A \\cup B",                plain: "A ∪ B" },
  intersect:  { label: "Intersection",         fx: "SETINTERSECT",  description: "In both",           tex: "A \\cap B",                plain: "A ∩ B" },
  difference: { label: "Difference",           fx: "SETDIFFERENCE", description: "In A, not B",       tex: "A \\setminus B",           plain: "A ∖ B" },
  symdiff:    { label: "Symmetric difference", fx: "SETSYMDIFF",    description: "In exactly one",    tex: "A \\mathbin{\\triangle} B", plain: "A △ B" },
};

// Set operations over two lists, compared by VALUE with first-seen order and UNIQUE's
// dedupe. Blanks aren't members; an error equals nothing, so it passes through where
// it sits (union, the A-side of difference) rather than vanishing.
export class SetOpNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Duplicates collapse to the first occurrence, and blank cells are never members.",
  };

  /** Element-preserving: the result is a subset of A ∪ B, so the output adopts
   *  the agreed element type (a strlist ∖ strlist stays a strlist). */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["a", "b"], combine: "agree" }];
  label: string;
  op: SetOp;
  cachedList: number[] = [];
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: SetOp }) {
    super("Set");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "difference";
    this.addInput("a", anyListIn("A"));
    this.addInput("b", anyListIn("B"));
    this.addOutput("result", adoptiveListOut("Result"));
  }

  data(inputs: { a?: unknown[][]; b?: unknown[][] }) {
    // Tags survive the passthrough, but membership keys by display magnitude.
    const a = stripUnitCells((inputs.a?.[0] ?? []) as unknown[]) as unknown[];
    const b = stripUnitCells((inputs.b?.[0] ?? []) as unknown[]) as unknown[];

    this.cachedList = setOperation(this.op, a, b) as number[];
    return { result: this.cachedList };
  }
}

// ─── Is In (membership mask) — Set & Relational pack ─────────────────────────
// A logical list ALIGNED to A. Membership stance matches the Set node: B's blanks and
// errors aren't members; an A-side blank or error propagates per cell.
export class IsInNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "A blank cell in Values yields a blank entry rather than FALSE. Blank cells in Set are never members.",
  };

  label: string;
  cachedList: unknown[] = [];
  width = 180;
  height = 170;

  constructor(init?: { label?: string }) {
    super("IsIn");
    this.label = init?.label ?? "Is In";
    this.addInput("a", anyListIn("Values"));
    this.addInput("b", anyListIn("Set"));
    this.addOutput("result", logicalListOut("Mask"));
  }

  data(inputs: { a?: unknown[][]; b?: unknown[][] }) {
    const result = isInMask((inputs.a?.[0] ?? []) as unknown[], (inputs.b?.[0] ?? []) as unknown[]);
    this.cachedList = result;
    return { result };
  }
}

/** Membership mask of `a` against set `b`, shared with the pack's ISIN formula:
 *  b's blanks/errors aren't members, and an a-side blank or error propagates. */
export function isInMask(a: readonly unknown[], b: readonly unknown[]): (boolean | null | SolError)[] {
  const members = new Set<unknown>();
  for (const v of b) if (!isMissing(v) && !isSolError(v)) members.add(setKey(v));
  return a.map((v) => {
    if (isMissing(v)) return null;
    if (isSolError(v)) return v as SolError;
    return members.has(setKey(v));
  });
}

// ─── Tally (value counts) — Set & Relational pack ─────────────────────────────
// Distinct value → count as a two-column Frame, first-seen order; blanks and errors
// aren't counted (same stance as Set).
export class TallyNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "Distinct values appear in first-seen order. Blank and error cells are not counted.",
  };

  label: string;
  cachedResult: FrameValue | null = null;
  width = 200;
  height = 200;

  constructor(init?: { label?: string }) {
    super("Tally");
    this.label = init?.label ?? "Tally";
    this.addInput("list", anyListIn("List"));
    this.addOutput("frame", frameOut("Counts"));
  }

  data(inputs: { list?: unknown[][] }) {
    const list = (inputs.list?.[0] ?? []) as unknown[];
    const { values, counts } = tallyPairs(list);
    const frame: FrameValue = {
      __frame: true,
      columns: [
        inferColumn("Value", values),
        { name: "Count", type: "number", values: counts },
      ],
    };
    this.cachedResult = list.length || values.length ? frame : null;
    return { frame: this.cachedResult };
  }
}

/** Distinct values with counts, keyed by VALUE so equal complexes tally together;
 *  blank/error cells are skipped. Shared with the pack's TALLY formula. */
export function tallyPairs(list: readonly unknown[]): { values: unknown[]; counts: number[] } {
  const counts = new Map<unknown, { value: unknown; count: number }>();
  for (const v of list) {
    if (isMissing(v) || isSolError(v)) continue;
    const k = setKey(v);
    const e = counts.get(k);
    if (e) e.count++; else counts.set(k, { value: v, count: 1 });
  }
  const entries = [...counts.values()];
  return { values: entries.map((e) => e.value), counts: entries.map((e) => e.count) };
}

export type SetRelation = "equal" | "subset" | "superset" | "disjoint";

export const SET_RELATION_META: Record<SetRelation, { label: string; description: string; fx: string; tex: string; plain: string }> = {
  equal:    { label: "Equal",    fx: "SETEQUAL",    description: "Same set",      tex: "A = B",                    plain: "A = B" },
  subset:   { label: "Subset",   fx: "SETSUBSET",   description: "A within B",    tex: "A \\subseteq B",           plain: "A ⊆ B" },
  superset: { label: "Superset", fx: "SETSUPERSET", description: "A contains B",  tex: "A \\supseteq B",           plain: "A ⊇ B" },
  disjoint: { label: "Disjoint", fx: "SETDISJOINT", description: "No overlap",    tex: "A \\cap B = \\varnothing", plain: "A ∩ B = ∅" },
};

// Set RELATION predicates over each side's distinct members, compared by VALUE;
// blanks and errors aren't members, both sides unwired → null, and the empty-set
// cases follow set theory (∅ ⊆ anything, ∅ disjoint with anything, ∅ = ∅).
export class SetRelationNode extends ClassicPreset.Node {
  label: string;
  op: SetRelation;
  cachedResult: Tri = null;
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: SetRelation }) {
    super("SetRelation");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "equal";
    this.addInput("a", anyListIn("A"));
    this.addInput("b", anyListIn("B"));
    this.addOutput("result", logicalOut("Result"));
  }

  data(inputs: { a?: unknown[][]; b?: unknown[][] }): { result: Tri } {
    const aRaw = inputs.a?.[0];
    const bRaw = inputs.b?.[0];
    // Nothing wired on either side — no sets to compare, so the relation is unknown.
    if (aRaw === undefined && bRaw === undefined) { this.cachedResult = null; return { result: null }; }

    const result = setRelation(this.op, (aRaw ?? []) as unknown[], (bRaw ?? []) as unknown[]);
    this.cachedResult = result;
    return { result };
  }
}

// TAKE / DROP moved to the one rank-preserving TakeDropNode (nodes/matrix.ts):
// list, matrix or scalar in, same rank out; the sign of the count is the direction.

// The 1-D rung of the append ladder (appendLadder): stays 1-D, VSTACK is the table stacker.
// Rows are wire-only — a typed literal list belongs to List Input.
export class ConcatListsNode extends ClassicPreset.Node {
  /** Element-preserving: the output adopts the agreed row type. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: this.valueInputKeys(), combine: "agree" }];
  label: string;
  cachedList: unknown[] = [];
  nextInputId = 0;
  width = 180;
  height = 210;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("ConcatLists");
    this.label = init?.label ?? "Concat Lists";
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("l"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 2; i++) this.addValueInput();
    this.addOutput("result", adoptiveListOut("Combined"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, anyListIn("List"));
    const n = parseInt(key.replace(/^l/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  /** Ordered list-row keys (insertion order = concatenation order). */
  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("l"));
  }

  addValueInput(): string {
    const key = `l${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
  }

  data(inputs: Record<string, unknown[][] | undefined>) {
    const out = concatLists(...this.valueInputKeys().map((k) => inputs[k]?.[0]));
    this.cachedList = out;
    return { result: out };
  }
}

export type { RunningOp } from "./listOps";
export type RunningMode = "all" | "window";

// No `fx`: the aggregator is an ARGUMENT of the windowed scan (aggregatorsAreArguments), so it claims no
// formula name. The labels are the dropdown's own words.
export const RUNNING_OP_META = {
  sum:     { label: "SUM",     description: "The running total: each element is the sum of its window." },
  avg:     { label: "AVERAGE", description: "The moving average: each element is the mean of its window." },
  min:     { label: "MIN",     description: "Smallest value in each window." },
  max:     { label: "MAX",     description: "Largest value in each window." },
  median:  { label: "MEDIAN",  description: "Middle value of each window." },
  product: { label: "PRODUCT", description: "Product of each window." },
  stdev:   { label: "STDEV",   description: "Sample standard deviation of each window. Divides by n−1." },
} satisfies Record<RunningOp, { label: string; description: string }>;

export const RUNNING_MODE_OPTIONS: ReadonlyArray<{ value: RunningMode; label: string; title: string }> = [
  { value: "all",    label: "Cumulative", title: "The window grows: every element from the start through this one" },
  { value: "window", label: "Last N",     title: "The window slides: only the last N elements ending at this one" },
];

export class RunningNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    window: "Rounds to a whole number of at least 1. The first elements use as much of the window as exists.",
  };

  label: string;
  op: RunningOp;
  mode: RunningMode;
  cachedList: ListCell[] | null = [];
  literals: Record<string, number> = { window: 3 };
  width = 180;
  height = 190;

  constructor(init?: { label?: string; op?: RunningOp; mode?: RunningMode }) {
    super("Running");
    this.label = init?.label ?? "Running";
    this.op = init?.op ?? "sum";
    this.mode = init?.mode ?? "all";
    this.addInput("list", listIn("List"));
    if (this.mode === "window") this.addInput("window", numIn("Window size"));
    this.addOutput("result", listOut("Result"));
    this.height = this.mode === "window" ? 218 : 190;
  }

  /** The mode owns the Window socket: Last N has it, Cumulative doesn't. Callers with
   *  a live graph prune the socket's cables BEFORE switching away from Last N. */
  setMode(next: RunningMode): void {
    if (next === this.mode) return;
    this.mode = next;
    if (next === "window") {
      if (!this.inputs.window) this.addInput("window", numIn("Window size"));
    } else if (this.inputs.window) {
      this.removeInput("window");
    }
    this.height = next === "window" ? 218 : 190;
  }

  data(inputs: { list?: ListCell[][]; window?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    if (this.mode === "window") {
      const wRaw = readInput(inputs.window, this.literals.window ?? 3);
      // A wired blank leaves the result unknown (value-semantics.md, "Reading an input").
      if (wRaw === null) { this.cachedList = null; return { result: null }; }
      const result = running(this.op, arr, wRaw);
      this.cachedList = result;
      return { result };
    }
    const result = running(this.op, arr, null);
    this.cachedList = result;
    return { result };
  }
}

export type DiffMode = "delta" | "percent" | "gradient";
const DIFF_OUTPUT_LABEL: Record<DiffMode, string> = { delta: "Differences", percent: "Change", gradient: "Gradient" };

export class DiffNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Δ and % are one element shorter (change from the element before); ∇ is the same length, the central-difference slope at each point.",
  };

  label: string;
  /** Absolute difference (Δ), consecutive percent change (pandas pct_change), or the
   *  central-difference gradient (numpy.gradient — same length). */
  mode: DiffMode = "delta";
  cachedList: ListCell[] | SolError = [];
  width = 180;
  height = 150;

  constructor(init?: { label?: string; mode?: DiffMode }) {
    super("Diff");
    this.label = init?.label ?? "DIFF";
    if (init?.mode) this.mode = init.mode;
    this.addInput("list",   listIn("List"));
    this.addOutput("result", listOut(DIFF_OUTPUT_LABEL[this.mode]));
  }

  setMode(next: DiffMode): void {
    this.mode = next;
    const out = this.outputs.result;
    if (out) out.label = DIFF_OUTPUT_LABEL[next];
  }

  data(inputs: { list?: ListCell[][] }) {
    const arr = inputs.list?.[0] ?? [];
    this.cachedList = this.mode === "percent" ? pctChangeList(arr) : this.mode === "gradient" ? gradientList(arr) : diffList(arr);
    return { result: this.cachedList };
  }
}

import type { ArgMinMaxOp } from "./listOps";
import { savgol, gaussianSmooth, lowess, findPeaks } from "./signalOps";
export type { ArgMinMaxOp } from "./listOps";

export const ARG_MIN_MAX_OP_META = {
  argmax: { label: "ARGMAX", description: "1-based position of the maximum value" },
  argmin: { label: "ARGMIN", description: "1-based position of the minimum value" },
  argsort:      { label: "ARGSORT",      description: "1-based positions that would sort the list ascending; reorder a parallel list by them. numpy.argsort, R order." },
  argsort_desc: { label: "ARGSORT DESC", description: "1-based positions that would sort the list descending. numpy.argsort(-x), R order with decreasing = TRUE." },
  which:        { label: "WHICH",        description: "1-based positions of the TRUE cells of a logical list. R which, numpy.flatnonzero. Excel: FILTER(SEQUENCE(n), cond)." },
} satisfies Record<ArgMinMaxOp, { label: string; description: string }>;

export class ArgMinMaxNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "1-based, like MATCH. Blank and error cells never win and sort to the end.",
  };
  label: string;
  op: ArgMinMaxOp;
  cachedResult: number | number[] | SolError | null = null;
  /** WHICH's logical-list input is typeable (the CSV editor stores its text here). */
  stringLiterals: Record<string, string> = {};
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: ArgMinMaxOp }) {
    super("ArgMinMax");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "argmax";
    this.addInput("list", ArgMinMaxNode.inputFor(this.op));
    this.addOutput("result", ArgMinMaxNode.outputFor(this.op));
  }

  /** WHICH reads a LOGICAL list; every other op a number list. */
  static inputFor(op: ArgMinMaxOp) { return op === "which" ? logicalListIn("Flags") : listIn("List"); }
  static outputFor(op: ArgMinMaxOp) { return ARG_LIST_OPS.has(op) ? numListOut("Positions") : numOut("Position"); }

  /** Re-types the sockets IN PLACE when the op crosses a family/rank boundary — no
   *  connection event fires, so the component prunes: dropInputCables on the input
   *  BEFORE the swap, retypeOutputCables on the output after. */
  setOp(next: ArgMinMaxOp): { inputChanged: boolean; outputChanged: boolean } {
    const inputChanged = (next === "which") !== (this.op === "which");
    const outputChanged = ARG_LIST_OPS.has(next) !== ARG_LIST_OPS.has(this.op);
    if (next === this.op) return { inputChanged: false, outputChanged: false };
    this.op = next;
    if (inputChanged) { const spec = ArgMinMaxNode.inputFor(next); this.inputs.list!.socket = spec.socket; this.inputs.list!.label = spec.label; }
    if (outputChanged) { const spec = ArgMinMaxNode.outputFor(next); this.outputs.result!.socket = spec.socket; this.outputs.result!.label = spec.label; }
    return { inputChanged, outputChanged };
  }

  data(inputs: { list?: ListCell[][] }) {
    const arr = inputs.list?.[0] ?? null;
    let result: number | number[] | SolError | null;
    if (arr === null) result = null;
    else if (this.op === "which") result = whichPositions(arr);
    else if (this.op === "argsort" || this.op === "argsort_desc") result = argsortList(arr, this.op === "argsort_desc");
    else result = argMinMax(this.op, arr);
    this.cachedResult = result;
    return { result };
  }
}

export class ContainsNode extends ClassicPreset.Node {
  label: string;
  cachedResult: boolean | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180;
  height = 160;

  constructor(init?: { label?: string }) {
    super("Contains");
    this.label = init?.label ?? "CONTAINS";
    // Membership is type-generic (setKey), so the sockets match the Set/Is In/Tally
    // siblings: any-element list, adoptive needle, LOGICAL answer.
    this.addInput("list",  anyListIn("List"));
    this.addInput("value", anyIn("Value"));
    this.addOutput("result", logicalOut("Found"));
  }

  data(inputs: { list?: unknown[][]; value?: unknown[] }) {
    const arr = inputs.list?.[0] ?? null;
    const v = readInput(inputs.value, this.literals.value as unknown);
    let result: boolean | null = null;
    // A blank needle can't be looked for — unknown, not "not asked yet".
    if (arr !== null && v !== null && v !== undefined) result = containsValue(arr, v);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Normalize ────────────────────────────────────────────────────────────────
export type NormalizeMode = "minmax" | "zscore";
const NORMALIZE_OUTPUT_LABEL: Record<NormalizeMode, string> = { minmax: "0–1", zscore: "z-scores" };

export class NormalizeNode extends ClassicPreset.Node {
  label: string;
  /** Rescale to 0–1 by min/max, or standardize to z-scores (distance from the mean in stdevs). */
  mode: NormalizeMode = "minmax";
  cachedList: ListCell[] | SolError = [];
  width = 180; height = 150;

  constructor(init?: { label?: string; mode?: NormalizeMode }) {
    super("Normalize");
    this.label = init?.label ?? "Normalize";
    if (init?.mode) this.mode = init.mode;
    this.addInput("list",    listIn("List"));
    this.addOutput("result", listOut(NORMALIZE_OUTPUT_LABEL[this.mode]));
  }

  setMode(next: NormalizeMode): void {
    this.mode = next;
    const out = this.outputs.result;
    if (out) out.label = NORMALIZE_OUTPUT_LABEL[next];
  }

  data(inputs: { list?: ListCell[][] }) {
    const arr = inputs.list?.[0] ?? [];
    this.cachedList = this.mode === "zscore" ? zscoreList(arr) : normalizeList(arr);
    return { result: this.cachedList };
  }
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────
export class ShuffleNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "The order holds until a recalculation. Changed values flow through without reshuffling.",
  };

  /** Element-preserving: the output adopts the input\'s type (passthrough.ts). */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  cachedList: unknown[] = [];
  width = 180; height = 150;
  // Volatile: per-slot sort keys, not a fixed permutation, so live values flow
  // through while the order holds until a recalc.
  private keys: number[] = [];
  private lastGen = -1;

  constructor(init?: { label?: string }) {
    super("Shuffle");
    this.label = init?.label ?? "Shuffle";
    this.addInput("list",    adoptiveListIn("List"));
    this.addOutput("result", adoptiveListOut("Shuffled"));
  }

  data(inputs: { list?: unknown[][] }) {
    const arr = [...(inputs.list?.[0] ?? [])];
    const gen = getRecalcGen();
    if (this.lastGen !== gen || this.keys.length !== arr.length) {
      this.keys = arr.map(() => Math.random());
      this.lastGen = gen;
    }
    const order = shuffleList(arr, this.keys);
    this.cachedList = order;
    return { result: order };
  }
}

// ─── NthElement ───────────────────────────────────────────────────────────────
export class NthElementNode extends ClassicPreset.Node {
  /** Element-preserving: the output adopts the input\'s type (passthrough.ts). */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  cachedList: unknown[] | null = [];
  literals: Record<string, number> = { n: 2 };
  width = 180; height = 160;

  constructor(init?: { label?: string }) {
    super("NthElement");
    this.label = init?.label ?? "Nth Element";
    this.addInput("list", adoptiveListIn("List"));
    this.addInput("n",    numIn("Step N"));
    this.addOutput("result", adoptiveListOut("Every Nth"));
  }

  data(inputs: { list?: unknown[][]; n?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    const nRaw = readInput(inputs.n, this.literals.n ?? 2);
    // A wired blank leaves the result unknown (value-semantics.md, "Reading an input").
    if (nRaw === null) { this.cachedList = null; return { result: null }; }
    this.cachedList = nthElement(arr, nRaw);
    return { result: this.cachedList };
  }
}

// ─── Interleave ───────────────────────────────────────────────────────────────
export class InterleaveNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "A shorter side contributes blanks so the alternation stays aligned.",
  };

  /** Element-preserving: cells alternate from A and B untouched, so the output
   *  adopts the agreed type of the two sides. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["a", "b"], combine: "agree" }];
  label: string;
  cachedList: unknown[] = [];
  width = 180; height = 160;

  constructor(init?: { label?: string }) {
    super("Interleave");
    this.label = init?.label ?? "Interleave";
    this.addInput("a", anyListIn("A"));
    this.addInput("b", anyListIn("B"));
    this.addOutput("result", adoptiveListOut("Interleaved"));
  }

  data(inputs: { a?: unknown[][]; b?: unknown[][] }) {
    const a = inputs.a?.[0] ?? [], b = inputs.b?.[0] ?? [];
    const out = interleave(a, b);
    this.cachedList = out;
    return { result: out };
  }
}

// ─── Pad ──────────────────────────────────────────────────────────────────────
export type PadDir = "right" | "left";

export const PAD_OP_META = {
  right: { label: "PADRIGHT", description: "Append Fill until list reaches N elements" },
  left:  { label: "PADLEFT",  description: "Prepend Fill until list reaches N elements" },
} satisfies Record<PadDir, { label: string; description: string }>;

export class PadNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    n: "A target at or below the list's length leaves it unchanged. Nothing is trimmed.",
  };

  /** Element-preserving: the output adopts the input\'s type (passthrough.ts). */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  op: PadDir;
  cachedList: unknown[] | null = [];
  literals: Record<string, number> = { n: 5, fill: 0 };
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: PadDir }) {
    super("Pad");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "right";
    this.addInput("list", adoptiveListIn("List"));
    this.addInput("n",    numIn("Target length"));
    this.addInput("fill", numIn("Fill value"));
    this.addOutput("result", adoptiveListOut("Padded"));
  }

  data(inputs: { list?: unknown[][]; n?: number[]; fill?: number[] }) {
    const arr  = inputs.list?.[0] ?? [];
    const nRaw = readInput(inputs.n, this.literals.n ?? 5);
    const fill = readInput(inputs.fill, this.literals.fill ?? 0);
    // A wired blank leaves the result unknown (value-semantics.md, "Reading an input").
    if (nRaw === null || fill === null) { this.cachedList = null; return { result: null }; }
    this.cachedList = padList(arr, nRaw, fill as unknown, this.op);
    return { result: this.cachedList };
  }
}

// ─── Weighted Statistics ──────────────────────────────────────────────────────

export type WeightedOp = "wavg" | "wvar" | "wstdev";

export const WEIGHTED_OP_META = {
  wavg:   { label: "WAVG",   description: "Weighted average: Σ(x·w) / Σw, which is SUMPRODUCT(x,w) over SUM(w) in Excel." },
  wvar:   { label: "WVAR",   description: "Weighted sample variance with reliability weights" },
  wstdev: { label: "WSTDEV", description: "Weighted sample standard deviation: √WVAR" },
} satisfies Record<WeightedOp, { label: string; description: string }>;

export class WeightedNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    weights: "Pairs with Values by position, and a pair with a blank on either side is dropped. Fewer weights than values blanks the result.",
  };

  label: string;
  op: WeightedOp;
  cachedResult: number | SolError | null = null;
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: WeightedOp }) {
    super("Weighted");
    this.label = init?.label ?? "";
    this.op    = init?.op    ?? "wavg";
    this.addInput("values",  listIn("Values"));
    this.addInput("weights", listIn("Weights"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { values?: (number | null | SolError)[][]; weights?: (number | null | SolError)[][] }) {
    const values  = inputs.values?.[0]  ?? null;
    const weights = inputs.weights?.[0] ?? null;
    const result = values && weights ? weighted(this.op, values, weights) : null;
    this.cachedResult = result;
    return { result };
  }
}

// ─── Reduce ───────────────────────────────────────────────────────────────────

export type ReduceOp = AggregateOp | "countblank";

export const REDUCE_OP_META = {
  sum:     { label: "SUM",     description: "Sums all values. Excel: SUM." },
  avg:     { label: "AVERAGE", description: "Arithmetic mean. Excel: AVERAGE." },
  min:     { label: "MIN",     description: "Smallest value. Excel: MIN." },
  max:     { label: "MAX",     description: "Largest value. Excel: MAX." },
  count:   { label: "COUNT",   description: "Number of values. Excel: COUNT." },
  countdistinct: { label: "COUNT DISTINCT", description: "Number of unique values. Excel: COUNTA(UNIQUE(range))." },
  countblank: { label: "COUNTBLANK", description: "Number of blank (missing) cells. Excel: COUNTBLANK." },
  median:  { label: "MEDIAN",  description: "Middle value. Excel: MEDIAN." },
  product: { label: "PRODUCT", description: "Multiply all values. Excel: PRODUCT." },
  stdev:   { label: "STDEV.S", description: "Sample standard deviation (n−1). Excel: STDEV.S." },
  stdev_p: { label: "STDEV.P", description: "Population standard deviation (n). Excel: STDEV.P." },
  var_s:   { label: "VAR.S",   description: "Sample variance (n−1). Excel: VAR.S." },
  var_p:   { label: "VAR.P",   description: "Population variance (n). Excel: VAR.P." },
  geomean: { label: "GEOMEAN", description: "Geometric mean (all values must be > 0). Excel: GEOMEAN." },
  harmean: { label: "HARMEAN", description: "Harmonic mean (all values must be > 0). Excel: HARMEAN." },
  sumsq:   { label: "SUMSQ",   description: "Sum of squares Σ(xi²). Excel: SUMSQ." },
  devsq:   { label: "DEVSQ",   description: "Sum of squared deviations from the mean. Excel: DEVSQ." },
  avedev:  { label: "AVEDEV",  description: "Mean absolute deviation from the mean. Excel: AVEDEV." },
  skew:    { label: "SKEW",    description: "Sample skewness of the distribution. Excel: SKEW." },
  skew_p:  { label: "SKEW.P",  description: "Population skewness. Divides by n. Excel: SKEW.P." },
  kurt:    { label: "KURT",    description: "Excess kurtosis of the distribution. Excel: KURT." },
  ptp:     { label: "PTP",     description: "Range of the data: max − min. numpy ptp (peak to peak), R diff(range(x)). Excel: MAX − MIN." },
  iqr:     { label: "IQR",     description: "Interquartile range: the 75th minus the 25th percentile (PERCENTILE.INC). scipy iqr, R IQR." },
  mad:     { label: "MAD",     description: "Median absolute deviation from the median, unscaled (scipy median_abs_deviation; R's mad multiplies by 1.4826). The robust spread." },
  sem:     { label: "SEM",     description: "Standard error of the mean: sample stdev ÷ √n. scipy sem, or sd(x)/sqrt(n) in R." },
  cv:      { label: "CV",      description: "Coefficient of variation: sample stdev ÷ mean. scipy variation, or sd(x)/mean(x) in R." },
  rms:     { label: "RMS",     description: "Root mean square: √ of the mean of the squares." },
} satisfies Record<ReduceOp, { label: string; description: string; fx?: string }>;

// The user-facing identity is "Aggregate", a fixed-op 1-D list aggregator — NOT the
// table-taking REDUCE lambda. The `reduce` op tokens are never user-visible.
// How an aggregate transforms the shared dimension of its inputs:
//   preserve (sum/avg/min/max/median/geomean/harmean/stdev/spread) → same dim ·
//   square (var/devsq/sumsq) → dim² · product → dimⁿ · everything else (count,
//   normalized moments) → dimensionless. `n` = the number of aggregated cells.
export function aggregateResultDim(op: ReduceOp, dim: Dim, n: number): Dim {
  if (isDimensionless(dim)) return DIMENSIONLESS;
  switch (op) {
    case "sum": case "avg": case "min": case "max": case "median":
    case "geomean": case "harmean": case "stdev": case "stdev_p": case "avedev":
    case "ptp": case "iqr": case "mad": case "sem": case "rms":
      return dim;
    case "var_s": case "var_p": case "devsq": case "sumsq":
      return dimPow(dim, 2);
    case "product":
      return dimPow(dim, n);
    default: // count, countdistinct, skew, skew_p, kurt, cv → a plain number
      return DIMENSIONLESS;
  }
}

export class AggregateNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "Blank cells are skipped, not counted as zero. One error cell makes the whole result that error.",
  };

  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  op: ReduceOp;
  cachedResult: number | UnitCell | SolError | null = null;
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: ReduceOp }) {
    super("Aggregate");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "sum";
    this.addInput("list",    listIn("List"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { list?: (number | null | SolError)[][] }) {
    // COUNTBLANK counts the MISSING cells, so it reads the raw list before the aggregation
    // below strips blanks away — and it answers even when every cell is blank.
    if (this.op === "countblank") {
      const result = (inputs.list?.[0] ?? []).filter((v) => isMissing(v)).length;
      this.cachedResult = result;
      return { result };
    }
    // Aggregator policy: a SolError PROPAGATES, `null` is SKIPPED, a dimensionless
    // cell ADOPTS the list's real unit (SUM($5, $2, 3) = $10), and only two genuinely
    // different dimensions are #UNIT! (base-SI storage already unifies km + m).
    const prep = forAggregateUnits(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    const arr = prep.nums;
    const dim = prep.dim;
    const result = aggregate(this.op, arr);
    if (isSolError(result)) { this.cachedResult = result; return { result }; }
    // Keep the display unit only where the op PRESERVES the dimension; PRODUCT/SUMSQ/
    // VAR derive a new one.
    const resultDim = aggregateResultDim(this.op, dim, arr.length);
    const tagged: number | UnitCell | null =
      result !== null && !isDimensionless(dim)
        ? tagDim(result, resultDim, dimEqual(resultDim, dim) ? prep.display : undefined)
        : result;
    this.cachedResult = tagged;
    return { result: tagged };
  }
}

// ─── RANDARRAY ────────────────────────────────────────────────────────────────

// An absurd count would allocate an array that freezes the UI, so it caps to
// #OVERFLOW!; the ceiling lives in listOps.ts so the formulas share this number.

export class RandArrayNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "Draws hold until a recalculation. A new Min or Max rescales the same draws rather than rerolling.",
  };

  label: string;
  /** Excel's integer flag: round every draw to a whole number. A card checkbox, not a
   *  socket — it selects a MODE (like the date family's basis), authored on the node. */
  integer = false;
  cachedList: number[] | SolError | null = [];
  literals: Record<string, number> = { count: 10 }; // min/max ship unset → muted 0/1 placeholders
  width = 180; height = 250;
  // Volatile: the raw [0,1) rolls hold until a recalc, but min/max apply live so new
  // bounds rescale the SAME draws.
  private rolls: number[] = [];
  private lastGen = -1;

  constructor(init?: { label?: string; integer?: boolean }) {
    super("RandArray");
    this.label = init?.label ?? "RANDARRAY";
    if (init?.integer != null) this.integer = init.integer;
    this.addInput("count", numIn("Count"));
    this.addInput("min",   numIn("Min"));
    this.addInput("max",   numIn("Max"));
    this.addOutput("list", listOut("List"));
  }

  data(inputs: { count?: number[]; min?: number[]; max?: number[] }): { list: number[] | SolError | null } {
    const countRaw = readInput(inputs.count, this.literals.count ?? 10);
    const lo    = readInput(inputs.min, this.literals.min ?? 0);
    const hi    = readInput(inputs.max, this.literals.max ?? 1);
    // A wired blank leaves the result unknown (value-semantics.md, "Reading an input").
    if (countRaw === null || lo === null || hi === null) {
      this.cachedList = null; this.rolls = []; this.lastGen = -1;
      return { list: null };
    }
    const count = Math.max(0, Math.floor(countRaw));
    if (count > MAX_GENERATED) {
      const e = solError("#OVERFLOW!", `RANDARRAY count ${count} exceeds the ${MAX_GENERATED} element limit`);
      this.cachedList = e; this.rolls = []; this.lastGen = -1;
      return { list: e };
    }
    const range = hi - lo;
    const gen = getRecalcGen();
    if (this.lastGen !== gen || this.rolls.length !== count) {
      this.rolls = Array.from({ length: count }, () => Math.random());
      this.lastGen = gen;
    }
    // integer rounds the rescaled draw (Excel's 5th arg), applied live like min/max, so
    // both surfaces agree (the formula's RANDARRAY rounds the same lo + r*range).
    const list = this.rolls.map((r) => { const x = lo + r * range; return this.integer ? Math.round(x) : x; });
    this.cachedList = list;
    return { list };
  }
}

// ─── XMATCH ───────────────────────────────────────────────────────────────────

export type { XMatchMatchMode, XMatchSearchMode };

export const XMATCH_MATCH_MODE_META: Record<XMatchMatchMode, string> = {
  exact:        "Exact match (0)",
  next_larger:  "Exact or next larger (1)",
  next_smaller: "Exact or next smaller (-1)",
};

/** Which end to scan from — so which DUPLICATE wins. Excel's binary modes (±2) are
 *  deliberately absent here as on the frame XLOOKUP: over a materialized column they
 *  find the row a linear scan already finds, so they'd be a speed knob with no
 *  distinct result (node-coverage.md). */
export const XMATCH_SEARCH_MODE_META: Record<XMatchSearchMode, { label: string; title: string }> = {
  first: { label: "First", title: "On duplicate values, return the first match, scanning top to bottom" },
  last:  { label: "Last",  title: "On duplicate values, return the last match, scanning bottom to top" },
};

export class XMatchNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "Text matches ignore case, like Excel's lookups. The approximate modes compare numbers and dates only.",
  };

  label: string;
  matchMode: XMatchMatchMode;
  searchMode: XMatchSearchMode;
  cachedResult: XMatchResult = null;
  literals: Record<string, number> = { value: 0 };
  stringLiterals: Record<string, string> = {};
  // The lookup is a wildcard VALUE slot, so its typed literal may be number or text.
  autoLiterals = true;
  width = 180; height = 232;

  constructor(init?: { label?: string; matchMode?: XMatchMatchMode; searchMode?: XMatchSearchMode }) {
    super("XMatch");
    this.label      = init?.label      ?? "XMATCH";
    this.matchMode  = init?.matchMode  ?? "exact";
    this.searchMode = init?.searchMode ?? "first";
    // The kernel is type-agnostic (lookupEq), so the sockets are too: any-family
    // lookup against any 1-D list. Approximate modes stay numeric IN the kernel.
    // `anycombo` value: a scalar lookup answers a scalar, a LIST lookup spills one
    // position per element — matching the XMATCH formula, which shares this kernel.
    this.addInput("value",  anyComboIn("Lookup value"));
    this.addInput("array",  adoptiveListIn("Array"));
    this.addOutput("result", numListOut("1-based position (#N/A when not found)"));
  }

  data(inputs: { value?: unknown[]; array?: unknown[][] }): { result: XMatchResult } {
    const val = pickSlot(this, inputs as Record<string, unknown[] | undefined>, "value");
    // A wired blank leaves the result unknown (value-semantics.md, "Reading an input").
    if (val === null) { this.cachedResult = null; return { result: null }; }
    const keys = inputs.array?.[0] ?? null;
    const ks = keys ?? [];
    // The XMATCH formula's `pick`, shared so the two surfaces can't drift: a hit → its
    // 1-based position; a miss → #N/A when the array is wired, else null (unknown).
    const pick = (l: unknown): number | SolError | null => {
      const found = xmatchIndex(l, ks, this.matchMode, this.searchMode);
      if (isSolError(found)) return found;
      if (found >= 0) return found + 1;
      return keys !== null ? solError("#N/A", "No match found in the array") : null;
    };
    const result = Array.isArray(val) ? val.map(pick) : pick(val);
    this.cachedResult = result;
    return { result };
  }
}

type XMatchResult = number | SolError | null | (number | SolError | null)[];

// ─── GROUPBY ─────────────────────────────────────────────────────────────────

export type GroupByOp = "sum" | "avg" | "min" | "max" | "count";

export const GROUP_BY_OP_META: Record<GroupByOp, { label: string; description: string }> = {
  sum:   { label: "SUM",   description: "Sum values in each group" },
  avg:   { label: "AVERAGE", description: "Average values in each group" },
  min:   { label: "MIN",   description: "Minimum value in each group" },
  max:   { label: "MAX",   description: "Maximum value in each group" },
  count: { label: "COUNT", description: "Count of items in each group" },
};

function groupByAggregate(vals: number[], op: GroupByOp): number {
  if (vals.length === 0) return 0;
  switch (op) {
    case "sum":   return vals.reduce((a, b) => a + b, 0);
    case "avg":   return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "min":   return iterMin(vals);
    case "max":   return iterMax(vals);
    case "count": return vals.length;
  }
}

export class GroupByNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "Pairs with Keys by position. Rows beyond the shorter list are ignored.",
    result: "One row per unique key: Key (adopting the keys input's element type) and the aggregated Value.",
  };

  label: string;
  op: GroupByOp;
  cachedResult: FrameValue | null = null;
  width = 180; height = 220;

  constructor(init?: { label?: string; op?: GroupByOp }) {
    super("GroupBy");
    this.label = init?.label ?? "Group Lists";
    this.op    = init?.op    ?? "sum";
    this.addInput("keys",   anyListIn("Keys"));
    this.addInput("values", listIn("Values"));
    // Unique keys + aggregated values are index-aligned, so they leave as ONE frame (C5):
    // Key adopts the keys input's element family (inferColumn), Value stays numeric.
    this.addOutput("result", frameOut("Groups"));
  }

  data(inputs: {
    keys?:   unknown[][];
    values?: number[][];
  }): { result: FrameValue | null } {
    // A wired blank keys list is unknown → blank frame; grouping keys by String(cell), so
    // tags are stripped first or a tagged key list buckets by object identity.
    const keysCell = inputs.keys?.[0] ?? null;
    if (keysCell === null) { this.cachedResult = null; return { result: null }; }
    const rawKeys = stripUnitCells(keysCell) as unknown[] | undefined;
    const rawVals = inputs.values?.[0] ?? [];

    if (!Array.isArray(rawKeys)) { this.cachedResult = null; return { result: null }; }

    const len = Math.min(rawKeys.length, rawVals.length);
    const order: (string | number)[] = [];
    const buckets = new Map<string, number[]>();

    for (let i = 0; i < len; i++) {
      const k = rawKeys[i] as string | number;
      const key = String(k);
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(k);
      }
      const v = Number(rawVals[i]);
      if (Number.isFinite(v)) buckets.get(key)!.push(v);
    }

    const aggValues = order.map((k) => groupByAggregate(buckets.get(String(k))!, this.op));
    const frame: FrameValue = {
      __frame: true,
      columns: [
        inferColumn("Key", order),
        { name: "Value", type: "number", values: aggValues },
      ],
    };
    this.cachedResult = frame;
    return { result: frame };
  }
}

// ─── Coalesce / Fill ────────────────────────────────────────────────────────────
// The explicit opt-in to treating `null` as something. A per-cell SolError is NOT
// missing: every mode passes errors through, and imputation uses present finites only.

export type FillOp =
  | "constant" | "ffill" | "bfill"
  | "mean" | "median" | "mode"
  | "interpolate" | "drop" | "coalesce";

// `fx` is declared, not despaced: despacing would split the FILL* family and collide
// with the INTERPOLATE node in stats.ts.
export const FILL_OP_META = {
  constant:    { label: "Constant",       fx: "FILLVALUE",       description: "Replace each missing (null) cell with a constant. Excel: IF." },
  ffill:       { label: "Forward fill",   fx: "FILLFORWARD",     description: "Carry the last present value forward over gaps. Pandas: ffill." },
  bfill:       { label: "Backward fill",  fx: "FILLBACKWARD",    description: "Carry the next present value back over gaps. Pandas: bfill." },
  mean:        { label: "Mean",           fx: "FILLMEAN",        description: "Impute gaps with the mean of present values" },
  median:      { label: "Median",         fx: "FILLMEDIAN",      description: "Impute gaps with the median of present values" },
  mode:        { label: "Mode",           fx: "FILLMODE",        description: "Impute gaps with the most common present value" },
  interpolate: { label: "Interpolate",    fx: "FILLINTERPOLATE", description: "Linearly interpolate interior gaps between bracketing present values" },
  drop:        { label: "Drop missing",   fx: "FILLDROP",        description: "Remove missing (null) cells, shortening the list. Pandas: dropna." },
  coalesce:    { label: "Coalesce",       fx: "COALESCE",        description: "First present of List then each Else in order, per position. SQL: COALESCE." },
} satisfies Record<FillOp, { label: string; fx: string; description: string }>;

type Cell = number | null | SolError;

/** Present finite numbers only, so an imputation statistic uses real data. */


/** Interior gaps only: unbracketed leading/trailing gaps stay null (no extrapolation),
 *  and a non-finite/error cell is a hard boundary, not a value to interpolate from. */

export class FillNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "Only the Fill with value operation reads it.",
  };

  label: string;
  op: FillOp;
  cachedList: Cell[] = [];
  literals: Record<string, number> = { value: 0 };
  nextInputId = 0;
  width = 200; height = 175;

  constructor(init?: { label?: string; op?: FillOp; valueKeys?: string[] }) {
    super("Fill");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "constant";
    this.addInput("list",  listIn("List"));
    this.addInput("value", numIn("Fill with")); // shown for the constant mode
    // extractInit's valueKeys snapshot includes the fixed inputs, so filter to the
    // "Else" row keys this node owns (the CHOOSE convention).
    const elseInit = init?.valueKeys?.filter((k) => /^e\d+$/.test(k)) ?? [];
    if (elseInit.length) for (const k of elseInit) this.addElseInput(k);
    else this.addValueInput();
    this.addOutput("result", listOut("Filled"));
  }

  private addElseInput(key: string): void {
    this.addInput(key, listIn("Else"));
    const n = parseInt(key.slice(1), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  addValueInput(): string {
    const key = `e${this.nextInputId}`;
    this.addElseInput(key);
    return key;
  }

  removeValueInput(key: string): void {
    if (/^e\d+$/.test(key)) this.removeInput(key);
  }

  /** The coalesce fallback keys, in row order. */
  elseKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => /^e\d+$/.test(k));
  }

  // Passes units like IFERROR: coalesce agrees across the list and its Else rows, and
  // every other mode fills from the list's own values, so its unit rides through.
  passthrough(): PassthroughSpec[] {
    return this.op === "coalesce"
      ? [{ output: "result", inputs: ["list", ...this.elseKeys()], combine: "agree" }]
      : [{ output: "result", inputs: ["list"], combine: "single" }];
  }

  data(inputs: { list?: Cell[][]; value?: number[] } & Record<string, Cell[][] | number[] | undefined>) {
    const arr = inputs.list?.[0] ?? null;
    if (!arr) { this.cachedList = []; return { result: [] }; }
    // A wired blank fill value fills a missing WITH a missing — those cells stay
    // blank rather than taking the number typed on the card.
    const constant = readInput(inputs.value, this.literals.value ?? 0);
    // N-ary in row order: a wired row contributes its list and may EXTEND the output;
    // an unwired typed literal broadcasts without extending; an untouched row is nothing.
    const fallbacks: (Cell[] | number | null)[] = this.elseKeys().map((k) => {
      const wired = (inputs[k] as Cell[][] | undefined)?.[0];
      if (Array.isArray(wired)) return wired;
      if (k in inputs) return null; // wired but empty — contributes nothing
      const lit = this.literals[k];
      return typeof lit === "number" ? lit : null;
    });
    const out = fillList(this.op, arr, { constant, fallbacks });
    this.cachedList = out;
    return { result: out };
  }
}

// ─── SPECTRUM (FFT) ──────────────────────────────────────────────────────────
export class SpectrumNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    rate: "Samples per unit time (Hz if per second); the frequency column is in those units. Leave at 1 for frequency in cycles per sample.",
    result: "One row per frequency bin 0..n/2: frequency, magnitude (a pure sine of amplitude A reads A), phase in radians.",
  };
  label: string;
  literals: Record<string, number> = { rate: 1 };
  cachedResult: ListCell[][] | null = null;
  width = 200; height = 160;

  constructor(init?: { label?: string }) {
    super("Spectrum");
    this.label = init?.label ?? "Spectrum (FFT)";
    this.addInput("list", listIn("Signal"));
    this.addInput("rate", numIn("Sample rate"));
    this.addOutput("result", tableOut("frequency, magnitude, phase"));
  }

  data(inputs: { list?: ListCell[][]; rate?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    const rate = readInput(inputs.rate, this.literals.rate ?? 1);
    if (rate === null || arr.length === 0) { this.cachedResult = null; return { result: null }; }
    const rows = spectrum(arr, rate);
    this.cachedResult = rows.map((r) => [r.frequency, r.magnitude, r.phase]);
    return { result: this.cachedResult };
  }
}

// ─── SMOOTH (Savitzky–Golay / LOWESS / Gaussian) ──────────────────────────────
export type SmoothOp = "savgol" | "lowess" | "gaussian";
export const SMOOTH_OP_META: Record<SmoothOp, { label: string; fx: string; params: { key: string; label: string; def: number }[]; description: string }> = {
  savgol:   { label: "Savitzky–Golay", fx: "SAVGOL", params: [{ key: "window", label: "Window", def: 5 }, { key: "order", label: "Order", def: 2 }], description: "Polynomial least-squares over a sliding window (odd width); keeps peak shape better than a moving average. scipy savgol_filter, R signal::sgolayfilt." },
  lowess:   { label: "LOWESS",         fx: "LOWESS", params: [{ key: "frac", label: "Fraction", def: 0.67 }], description: "Locally weighted linear regression over the nearest fraction of points, three robust passes. statsmodels lowess, R lowess / loess." },
  gaussian: { label: "Gaussian", fx: "GAUSSIANSMOOTH", params: [{ key: "sigma", label: "Sigma", def: 1 }], description: "Gaussian-weighted average, σ in samples, edges reflected. scipy gaussian_filter1d." },
};

export class SmoothNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "Blank and error cells are skipped by the fits and stay blank in the result.",
    window: "Odd number of neighbours, larger than the order.",
    frac: "Share of the points in each local fit, 0–1; larger is smoother.",
  };
  label: string;
  op: SmoothOp;
  literals: Record<string, number> = {};
  cachedList: ListCell[] = [];
  width = 190; height = 200;

  constructor(init?: { label?: string; op?: SmoothOp }) {
    super("Smooth");
    this.op = init?.op ?? "savgol";
    this.label = init?.label ?? "";
    this.addInput("list", listIn("List"));
    for (const prm of SMOOTH_OP_META[this.op].params) { this.addInput(prm.key, numIn(prm.label)); this.literals[prm.key] = prm.def; }
    this.addOutput("result", listOut("Smoothed"));
  }

  /** The op owns its parameter sockets; a live caller prunes the departing ones' cables first. */
  setOp(next: SmoothOp): string[] {
    if (next === this.op) return [];
    const before = SMOOTH_OP_META[this.op].params.map((q) => q.key), after = SMOOTH_OP_META[next].params;
    const removed = before.filter((k) => !after.some((q) => q.key === k));
    this.op = next;
    for (const k of removed) if (this.inputs[k]) this.removeInput(k);
    for (const q of after) { if (!this.inputs[q.key]) this.addInput(q.key, numIn(q.label)); this.literals[q.key] ??= q.def; }
    return removed;
  }

  data(inputs: { list?: ListCell[][]; window?: number[]; order?: number[]; frac?: number[]; sigma?: number[] }) {
    const arr = inputs.list?.[0] ?? null;
    const prm = (k: "window" | "order" | "frac" | "sigma", def: number) => readInput(inputs[k], this.literals[k] ?? def);
    let out: ListCell[] | null;
    if (arr === null) out = null;
    else if (this.op === "savgol") { const w = prm("window", 5), o = prm("order", 2); out = w === null || o === null ? null : savgol(arr, w, o); }
    else if (this.op === "lowess") { const f = prm("frac", 0.67); out = f === null ? null : lowess(arr, f); }
    else { const sg = prm("sigma", 1); out = sg === null ? null : gaussianSmooth(arr, sg); }
    this.cachedList = out ?? [];
    return { result: out };
  }
}

// ─── FIND PEAKS ───────────────────────────────────────────────────────────────
export class FindPeaksNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "One row per local maximum that passes every filter: Position (1-based) and Height.",
    height: "Leave blank for no minimum.",
    distance: "Minimum spacing between kept peaks (in samples); the higher peak wins.",
    prominence: "Minimum rise above the higher of the two surrounding valleys: the filter that separates peaks from ripples.",
  };
  label: string;
  literals: Record<string, number> = {};
  cachedResult: FrameValue | null = null;
  width = 190; height = 230;

  constructor(init?: { label?: string }) {
    super("FindPeaks");
    this.label = init?.label ?? "Find Peaks";
    this.addInput("list", listIn("List"));
    this.addInput("height", numIn("Min height"));
    this.addInput("distance", numIn("Min distance"));
    this.addInput("prominence", numIn("Min prominence"));
    // Position + Height are index-aligned, so they leave as ONE frame (C5).
    this.addOutput("result", frameOut("Peaks"));
  }

  data(inputs: { list?: ListCell[][]; height?: number[]; distance?: number[]; prominence?: number[] }): { result: FrameValue | null } {
    const arr = inputs.list?.[0] ?? null;
    const opt = (k: "height" | "distance" | "prominence") => {
      const v = readInput(inputs[k], this.literals[k]);
      return v === null || v === undefined || Number.isNaN(v) ? undefined : v;
    };
    if (arr === null) { this.cachedResult = null; return { result: null }; }
    const peaks = findPeaks(arr, { height: opt("height"), distance: opt("distance"), prominence: opt("prominence") });
    const frame: FrameValue = {
      __frame: true,
      columns: [
        { name: "Position", type: "number", values: peaks.map((p) => p.position) },
        { name: "Height", type: "number", values: peaks.map((p) => p.value) },
      ],
    };
    this.cachedResult = frame;
    return { result: frame };
  }
}
