import { ClassicPreset } from "rete";
import { numListSocket, strListSocket, dateListSocket, logicalListSocket, type SolenoidSocket } from "../sockets";
import { parseListLiteral } from "../coerceInputs";
import { parseDateToSerial } from "./date";
import type { Cell as AnyCell } from "./coerce";
import { getRecalcGen } from "../process";
import { listIn, listOut, numIn, numOut, anyIn, trueAnyIn, staticTrueAnyOut, strIn, logicalOut, logicalListOut, frameIn, frameOut, anyListIn, adoptiveListIn, adoptiveListOut } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { pairIdsFromKeys } from "./logic";
import { passesFilter, VALUELESS_FILTER_OPS, type FilterOp, type FilterCondConfig } from "../frameVerbs";
import { solError, isSolError, type SolError } from "../errorValue";
import { forAggregate, isMissing, coerceLogical, type Tri } from "../valueKinds";
import { forAggregateUnits, tagDim, matrixUnitOf, type UnitCell } from "../unitValue";
import { stripUnitCells } from "../unitBridge";
import { tagFrameCellUnit } from "../unitColumn";
import { type Dim, DIMENSIONLESS, dimPow, dimEqual, isDimensionless } from "../dimension";
import { iterMin, iterMax } from "./mathUtils";
import { isFrameValue, isCubeValue, cubeRowCount, cubeFromColumns, frameRowCount, inferColumn, getColumn, type FrameValue, type FrameColumn, type CubeValue, type CubeCell, type FrameCell, type FrameColType } from "../frame";

// ─── List Input ─────────────────────────────────────────────────────────────

export type ListElemType = "number" | "string" | "date" | "logical";

const LIST_ELEM_SOCKET: Record<ListElemType, SolenoidSocket> = {
  number: numListSocket,
  string: strListSocket,
  date: dateListSocket,
  logical: logicalListSocket,
};

/** Parse one row's comma-separated text into a typed list. Delegates to the ONE
 *  typed-list literal parser (`parseListLiteral`) so a row parses identically however
 *  the SegToggle is set: RFC-4180 quoting everywhere (`"First, Last", qty` is two
 *  fields in EVERY mode), and an unparseable part is first-class `null` in every mode.
 *
 *  This used to be a second, divergent parser — a naive `split(",")` with a
 *  drop-what-doesn't-parse rule — and it was DEAD for three of the four types:
 *  coerceInputs injects `parseListLiteral`'s result for any `TYPEABLE_LIST` socket
 *  (strlist/datelist/logicallist) before data() runs, so only Number mode ever reached
 *  it. That's why quoting worked in Text mode but not Number mode, and why Date mode
 *  emitted NaN where Number mode dropped the cell. One parser, one policy. */
function parseCsvList(dt: ListElemType, s: string | undefined): AnyCell[] {
  return s ? (parseListLiteral(s, LIST_ELEM_SOCKET[dt].dataType) as AnyCell[]) : [];
}

/** Convert ONE wired element to the row's element type, or `null` when it genuinely
 *  can't be. List Input is a typed literal SOURCE — its whole job is "emit a list of
 *  type T" — so a wired element is CONVERTED, exactly like the typed text on the same
 *  row. It used to be FILTERED (`typeof v === …`, anything else silently discarded),
 *  which had two bad consequences:
 *
 *   • The same value behaved differently typed vs wired: `01-Jan-2026` typed into a
 *     Date row parses to a serial, but wired in it was thrown away.
 *   • A WILDCARD source (`any`/`anylist`/`trueany` — a Display, a Conduit lane, an
 *     INDEX result) is ACCEPTED by every row socket via the wildcard ladder, but its
 *     runtime value is whatever flowed in. A number reaching a Text row made the whole
 *     list vanish — an empty output with no cable rejected and no error shown.
 *
 *  `null` (MISSING) and per-cell `SolError`s never reach here — they ride through any
 *  typed list unchanged and are handled by the caller. */
function coerceElem(dt: ListElemType, v: unknown): AnyCell {
  switch (dt) {
    case "number": {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "string") { const n = Number(v.trim()); return v.trim() !== "" && Number.isFinite(n) ? n : null; }
      return null;
    }
    case "date": {
      // Dates ARE serials, so a number passes straight through; a date STRING parses
      // with the same parser the typed row uses.
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") { const n = parseDateToSerial(v); return Number.isFinite(n) ? n : null; }
      return null;
    }
    case "string":
      // A text list stringifies whatever arrives — that IS the conversion, and it's
      // what makes a wildcard carrying numbers produce ["1","2"] instead of [].
      if (typeof v === "string") return v;
      return typeof v === "number" || typeof v === "boolean" ? String(v) : null;
    case "logical":
      return coerceLogical(v);
  }
}

export class ListInputNode extends ClassicPreset.Node {
  label: string;
  // Homogeneous list of the selected element type: numbers, strings, date serials, or
  // booleans. Cast to DisplayValue at the value box.
  cachedList: AnyCell[] = [];
  // The element type, switched by the card's SegToggle (re-types the row + output
  // sockets in place — see setDataType).
  dataType: ListElemType;
  // Each row holds a comma-separated LIST typed in place ("1, 2, 3" · "a, b, c" ·
  // "01-Jan-2026, 02-Jan-2026" · "true, false"); a wired list on the row overrides its
  // text. All rows concatenate into the output — so the node both builds a list from
  // typed values AND joins several wired lists. Sparse: only rows with text (or a
  // cable) contribute.
  stringLiterals: Record<string, string> = {};
  // Extensible inputs: rows are added/removed by the user (see ExtensibleInputs).
  // `nextInputId` keeps keys unique across removals.
  nextInputId = 0;
  width = 180;
  height = 200;

  /** The list socket for the current element type — new rows adopt it. */
  get valueSocket(): SolenoidSocket { return LIST_ELEM_SOCKET[this.dataType]; }

  constructor(init?: { label?: string; valueKeys?: string[]; dataType?: ListElemType }) {
    super("ListInput");
    this.label = init?.label ?? "List Input";
    this.dataType = init?.dataType ?? "number";
    // Rebuild the exact input keys on load/paste (so saved literals + cables still line
    // up); otherwise start with a single blank row.
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

  /** Switch the element type IN PLACE: re-type every row input socket + the output
   *  socket. The component follows with retypeOutputCables + a recompute (an in-place
   *  socket retype fires no connection event — see the type-propagation invariant).
   *  Returns false (no-op) when the type is unchanged. */
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
      // `readInput` semantics: a CONNECTED cable wins even when its value is `null` —
      // only an UNWIRED row (undefined) falls back to the typed text. The old
      // `wired != null` test resurrected the row's text for a wired MISSING, which is
      // the `??`-swallowing bug (a blank flowing in became whatever was typed in the box).
      const slot = inputs[key];
      const wired = slot === undefined || slot.length === 0 ? undefined : (slot[0] ?? null);
      if (wired !== undefined) {
        const arr = Array.isArray(wired) ? wired : [wired];
        // `null` (MISSING) and a per-cell SolError ride through UNCHANGED — dropping
        // them compacted the list (positions shifted out of step with any parallel
        // list) and made an upstream #DIV/0! vanish instead of propagating. Everything
        // else is CONVERTED to the row's type rather than filtered (see coerceElem).
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

export class RangeNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  // No default for `stop` — an unset stop keeps the range empty until
  // the user provides one (cable or literal).
  literals: Record<string, number> = { start: 0, step: 1 };
  width = 180;
  height = 220;

  constructor(init?: { label?: string }) {
    super("Range");
    this.label = init?.label ?? "Range";
    this.addInput("start", numIn("Start"));
    this.addInput("stop",  numIn("Stop"));
    this.addInput("step",  numIn("Step"));
    this.addOutput("list", listOut("List"));
  }

  data(inputs: { start?: number[]; stop?: number[]; step?: number[] }) {
    const start = inputs.start?.[0] ?? this.literals.start ?? 0;
    const stop  = inputs.stop?.[0]  ?? this.literals.stop  ?? null;
    const step  = inputs.step?.[0]  ?? this.literals.step  ?? 1;
    const list: number[] = [];
    if (stop !== null && step !== 0) {
      const goUp = step > 0;
      let cur = start;
      while (goUp ? cur < stop : cur > stop) {
        list.push(cur);
        cur += step;
        if (list.length >= 1000) break;
      }
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
    // Element-blind (it only counts) — anylist like the other position ops.
    this.addInput("list", anyListIn("List"));
    this.addOutput("result", numOut("Count"));
  }

  data(inputs: { list?: number[][] }) {
    const arr = inputs.list?.[0] ?? null;
    this.cachedResult = arr ? arr.length : null;
    return { result: this.cachedResult };
  }
}

// INDEX is cube/frame-aware: its input + output are `any` so it reads a cell out
// of ANY container — the nth of a list, the (row, col) of a matrix, OR the cell of
// a Frame / Cube. A frame/cube cell comes out as `any`, so a NESTED frame/cube
// pulled from a cube cell flows on as a frame/cube you can keep working on. This
// is how you read a relate-built cube back out (see docs/cube-node-scope.md). The
// 1-D list path keeps Excel's INDEX(array, n); `column` is the 2-D second arg.
//
// Excel's whole-axis form (2026-07-15): a BLANK or 0 Row means ALL rows — the
// whole column — and a blank/0 Column means ALL columns — the whole row — exactly
// INDEX(range, 0, col) / INDEX(range, row, 0). Both blank passes the container
// through whole. Slice shapes follow the app's existing accessor conventions:
// a frame row-slice is a ONE-ROW FRAME (Get Row / XLOOKUP `*`), a frame
// column-slice is the values LIST (Get Column); cube slices stay CUBES (nested
// cells come out whole); matrix slices are 1-D lists. The Row/Column literal
// fields default EMPTY with an `[all]` placeholder (the socket-label
// `(default …)` convention).
export class ListIndexNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null | CubeCell | FrameValue | CubeValue = null;
  literals: Record<string, number> = {}; // 1-based (Excel INDEX); unset = [all]
  width = 180;
  height = 190;

  constructor(init?: { label?: string }) {
    super("ListIndex");
    this.label = init?.label ?? "INDEX";
    this.addInput("list",  trueAnyIn("Array")); // list, matrix, frame, or cube
    this.addInput("index", numIn("Row (default [all])"));
    this.addInput("column", numIn("Column (default [all])"));   // 2-D / frame / cube only
    // The result's type varies per row/column (a cube cell can be a nested
    // frame), so it stays the STATIC wildcard — never adopts.
    this.addOutput("result", staticTrueAnyOut("Value"));
  }

  data(inputs: { list?: unknown[]; index?: number[]; column?: number[] }): { result: number | SolError | null | CubeCell | FrameValue | CubeValue } {
    const v = inputs.list?.[0] ?? null;
    const rowIn = inputs.index?.[0] ?? this.literals.index ?? null;
    const colIn = inputs.column?.[0] ?? this.literals.column ?? null;
    const done = (result: number | SolError | null | CubeCell | FrameValue | CubeValue) => {
      this.cachedResult = result;
      return { result };
    };
    if (v === null || v === undefined) return done(null);
    // Excel INDEX: 0 (or omitted) selects the WHOLE axis.
    const rowAll = rowIn === null || Math.round(rowIn) === 0;
    const colAll = colIn === null || Math.round(colIn) === 0;
    const r = rowAll ? -1 : Math.round(rowIn as number) - 1;
    const c = colAll ? -1 : Math.round(colIn as number) - 1;
    const refErr = (n: number, max: number, what: string) =>
      solError("#REF!", `${what} ${n} is outside 1…${max}`);

    if (isCubeValue(v)) {
      if (rowAll && colAll) return done(v);
      const rows = cubeRowCount(v);
      if (!rowAll && (r < 0 || r >= rows)) return done(refErr(r + 1, rows, "Row"));
      if (!colAll && (c < 0 || c >= v.columns.length)) return done(refErr(c + 1, v.columns.length, "Column"));
      // Whole column / whole row stay CUBES so nested cells survive intact.
      if (rowAll) return done(cubeFromColumns([v.columns[c]]));
      if (colAll) return done(cubeFromColumns(v.columns.map((col) => ({ name: col.name, type: col.type, cells: [col.cells[r] ?? null] }))));
      return done(v.columns[c].cells[r] ?? null);
    }
    if (isFrameValue(v)) {
      if (rowAll && colAll) return done(v);
      const rows = frameRowCount(v);
      if (!rowAll && (r < 0 || r >= rows)) return done(refErr(r + 1, rows, "Row"));
      if (!colAll && (c < 0 || c >= v.columns.length)) return done(refErr(c + 1, v.columns.length, "Column"));
      // Whole column = the values list (Get Column's shape). A unit-locked column
      // tags each cell so the unit rides out of the frame (same as Get Column).
      if (rowAll) {
        const col = v.columns[c];
        return done((col.unit ? col.values.map((x) => tagFrameCellUnit(x, col.unit!)) : [...col.values]) as CubeCell);
      }
      if (colAll) {
        // Whole row = a ONE-ROW FRAME (Get Row / XLOOKUP `*` convention).
        const columns: FrameColumn[] = v.columns.map((col) => ({
          ...col, values: [col.values[r] ?? null], raw: col.raw ? [col.raw[r] ?? ""] : undefined,
        }));
        return done({ __frame: true, columns });
      }
      // A single cell from a unit-locked column carries the column's unit.
      const cell = v.columns[c].values[r] ?? null;
      return done(v.columns[c].unit ? (tagFrameCellUnit(cell, v.columns[c].unit!) as CubeCell) : cell);
    }

    if (!Array.isArray(v)) {
      // A scalar wired in is a 1×1 — row/col 1 (or [all]) returns it, anything else #REF!.
      const ok = (rowAll || r === 0) && (colAll || c === 0);
      return done(ok ? (v as number) : solError("#REF!", "Index is outside a single value; only index 1 exists"));
    }

    if (Array.isArray((v as unknown[])[0])) {
      // A genuine 2-D matrix.
      const grid = v as unknown[][];
      // A homogeneous matrix unit (D20) rides out into an extracted cell/row/column
      // exactly like a frame column's unit — tag each extracted number so the unit
      // isn't lost (mirrors the frame branch above; the whole-grid case keeps its tag
      // since it returns the same array). `tag` is identity when the matrix is plain.
      const mUnit = matrixUnitOf(v);
      const tag = (x: unknown): unknown => (mUnit ? tagFrameCellUnit(x, mUnit) : x);
      if (rowAll && colAll) return done(grid as CubeCell);
      if (!rowAll && (r < 0 || r >= grid.length)) return done(refErr(r + 1, grid.length, "Row"));
      if (rowAll) {
        // Whole column as a 1-D list (a ragged short row contributes null).
        const width = grid.reduce<number>((m, row) => Math.max(m, Array.isArray(row) ? row.length : 1), 0);
        if (c < 0 || c >= width) return done(refErr(c + 1, width, "Column"));
        return done(grid.map((row) => tag(Array.isArray(row) ? (row[c] ?? null) : c === 0 ? row : null)) as CubeCell);
      }
      const rowArr = Array.isArray(grid[r]) ? grid[r] : [grid[r] as unknown];
      if (colAll) return done(rowArr.map(tag) as CubeCell); // whole row as a 1-D list
      if (c < 0 || c >= rowArr.length) return done(refErr(c + 1, rowArr.length, "Column"));
      return done(tag(rowArr[c] ?? null) as CubeCell);
    }

    // A flat 1-D list — the existing is2D convention treats it as an n×1 column,
    // so Column (when given) must be 1.
    const arr = v as (number | SolError | null)[];
    if (!colAll && c !== 0) return done(refErr(c + 1, 1, "Column"));
    if (rowAll) return done([...arr] as CubeCell); // whole column = the list itself
    if (r < 0 || r >= arr.length) return done(refErr(r + 1, arr.length, "list"));
    return done(arr[r]);
  }
}

export type SortDir = "asc" | "desc";

export class SortNode extends ClassicPreset.Node {
  label: string;
  dir: SortDir;
  cachedList: number[] = [];
  width = 180;
  height = 150;

  constructor(init?: { label?: string; dir?: SortDir }) {
    super("Sort");
    this.label = init?.label ?? "List Sort";
    this.dir = init?.dir ?? "asc";
    this.addInput("list", listIn("List"));
    this.addOutput("result", listOut("Sorted"));
  }

  data(inputs: { list?: (number | null | SolError)[][] }) {
    const arr = inputs.list?.[0] ?? [];
    // Nulls and per-cell errors sort LAST in both directions, stably — the
    // frame sort's blanks-last policy (frameVerbs.sortByColumn / engine.rs
    // with_nulls_last, Excel's blanks-last). A bare numeric compare would
    // coerce null to 0 and an error to NaN, scattering both mid-list.
    const isTail = (v: unknown) => isMissing(v) || isSolError(v);
    const idx = arr.map((_, i) => i);
    idx.sort((i, j) => {
      const ti = isTail(arr[i]), tj = isTail(arr[j]);
      if (ti || tj) return ti && tj ? i - j : ti ? 1 : -1; // tail last, stable
      const c = (arr[i] as number) - (arr[j] as number);
      return c !== 0 ? (this.dir === "desc" ? -c : c) : i - j; // stable on ties
    });
    const sorted = idx.map((i) => arr[i]) as number[];
    this.cachedList = sorted;
    return { result: sorted };
  }
}

// Position-based (element-blind) 1-D utilities — Reverse, Slice, Take, Drop,
// Shuffle, NthElement, Interleave, Pad — ride the element-agnostic `anylist`
// sockets: they only move positions, so text/date/logical lists work too
// (the D15 coherence sweep). Order/arithmetic ops (Sort, Cumulative) stay
// typed — they need comparison/arithmetic semantics.
export class ReverseNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
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
    const reversed = [...arr].reverse();
    this.cachedList = reversed;
    return { result: reversed };
  }
}

export class SliceNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  cachedList: unknown[] = [];
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
    const start = Math.round(inputs.start?.[0] ?? this.literals.start ?? 1);
    const endRaw = inputs.end?.[0] ?? this.literals.end;
    const end = endRaw === undefined ? undefined : Math.round(endRaw);
    // 1-based inclusive → JS slice(start-1, end).
    const sliced = arr.slice(Math.max(0, start - 1), end);
    this.cachedList = sliced;
    return { result: sliced };
  }
}

// ─── Filter ────────────────────────────────────────────────────────────────────
// The 1-D filter, redesigned 2026-07-09 (decisions.md D16): a list tested
// against ITS OWN values with the frame Filter's condition engine — extensible
// condition rows (op + value, per-row Match case) combined with AND/OR, any
// element family (anylist). What it deliberately no longer does: accept a
// table (filtering a table's rows is the frame Filter's job — a matrix widens
// into it as Col1..N), or take a "Keep if" mask (filtering one list by a
// PARALLEL list is SUMIFS below for aggregation, or Frame from Lists → Filter
// Rows for the filtered list itself). Kept ∪ Dropped stays the exhaustive
// complement: a null/error cell fails its condition and lands in Dropped.

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

/** Read a Filter/SUMIFS Value slot: the wired value wins over the literal even
 *  when it's `null` (the readInput rule) — a wired missing reads as "not written
 *  yet" (blank). A wired scalar STRINGIFIES, so both engines see exactly what a
 *  typed literal would say ("5", "true", a date serial); a wired SolError becomes
 *  its code text, which matches no rows (the unparseable-value rule). */
export function readFilterValue(wired: unknown[] | undefined, literal: string | undefined): string {
  const raw: unknown = wired !== undefined && wired.length > 0 ? wired[0] : (literal ?? "");
  if (raw === null || raw === undefined) return "";
  if (isSolError(raw)) return raw.code;
  return String(raw);
}

export class FilterNode extends ClassicPreset.Node {
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

  /** Element-preserving: filtering keeps the element type (and unit / number
   *  format), so BOTH outputs adopt the wired input's concrete type — a numeric
   *  list in reads as a numeric list out (not an opaque `anylist`), and the cable
   *  connects to a typed consumer. See passthrough.ts + the data() note on units. */
  passthrough = (): PassthroughSpec[] => [
    { output: "result", inputs: ["list"], combine: "single" },
    { output: "dropped", inputs: ["list"], combine: "single" },
  ];

  private addCondWithId(id: number): void {
    // `any` (scalar): a wired Slider/Number/Date/Boolean threshold connects;
    // unwired, the typed text field is the literal (parsed per the list's type).
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
    // The node is a passthrough (see passthrough()), so a dimensioned input arrives
    // with its `UnitCell` tags intact. Unwrap each cell to its DISPLAY magnitude for
    // the predicate + type detection (passesFilter does numeric compares — a raw cell
    // Number()s to NaN), but keep the ORIGINAL cells for the outputs so the kept /
    // dropped lists stay dimensioned. A plain list has no cells to strip — no-op.
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
      if (!valueless && val.trim() === "") continue; // "not written yet" — excluded (frame-Filter parity)
      conds.push({ op, value: val, matchCase: cfg?.matchCase ?? false });
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
// Conditional aggregation over ONE FRAME (D16, amended): aggregate the Values
// COLUMN over the rows where every criteria row (column + op + value) passes —
// AND-only like Excel's *IFS. The 2026-07-06 standing rule applies: position-
// aligned columns arrive as a frame, never as parallel list sockets the user
// lines up by hand (parallel lists route through Frame from Lists first).
// A blank/error criteria cell fails that criterion.

export type CondAggOp = "sumifs" | "countifs" | "averageifs" | "minifs" | "maxifs";

export const COND_AGG_OP_META = {
  sumifs:     { label: "SUMIFS",     description: "Sum the Values column over the rows where every criteria row passes. Excel: SUMIFS / SUMIF." },
  countifs:   { label: "COUNTIFS",   description: "Count the rows where every criteria row passes (needs no Values column). Excel: COUNTIFS / COUNTIF." },
  averageifs: { label: "AVERAGEIFS", description: "Average the Values column where every criteria row passes; nothing matching is #DIV/0! like Excel. Excel: AVERAGEIFS / AVERAGEIF." },
  minifs:     { label: "MINIFS",     description: "Smallest Values-column cell where every criteria row passes; nothing matching is 0 like Excel. Excel: MINIFS." },
  maxifs:     { label: "MAXIFS",     description: "Largest Values-column cell where every criteria row passes; nothing matching is 0 like Excel. Excel: MAXIFS." },
} satisfies Record<CondAggOp, { label: string; description: string }>;

export class SumIfsNode extends ClassicPreset.Node {
  label: string;
  op: CondAggOp;
  /** Per-pair {op, matchCase}, keyed by the pair id (the `column${id}` suffix). */
  condConfig: Record<string, FilterCondConfig> = {};
  stringLiterals: Record<string, string> = {};
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["Column", "Value"];
  cachedResult: number | UnitCell | SolError | null = null;
  width = 210;
  height = 280;

  constructor(init?: {
    label?: string; op?: CondAggOp;
    condConfig?: Record<string, FilterCondConfig>; valueKeys?: string[];
  }) {
    super("SumIfs");
    this.op = init?.op ?? "sumifs";
    this.label = init?.label ?? COND_AGG_OP_META[this.op].label;
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
    const f = inputs.frame?.[0] as FrameValue | null | undefined;
    if (!isFrameValue(f)) return finish(null);
    interface Crit { col: FrameColumn; op: FilterOp; value: string; matchCase: boolean }
    const crits: Crit[] = [];
    for (const [colKey, valKey] of this.valuePairKeys()) {
      const id = colKey.slice(6);
      const name = String(inputs[colKey]?.[0] ?? this.stringLiterals[colKey] ?? "").trim();
      const cfg = this.condConfig[id];
      const op: FilterOp = cfg?.op ?? "eq";
      const val = readFilterValue(inputs[valKey], this.stringLiterals[valKey]);
      const valueless = op === "isblank" || op === "notblank"; // no value to write
      if (name === "" || (!valueless && val.trim() === "")) continue; // row not written yet
      const col = getColumn(f, name);
      if (!col) return finish(solError("#REF!", `No column "${name}" in the frame`));
      crits.push({ col, op, value: val, matchCase: cfg?.matchCase ?? false });
    }
    if (crits.length === 0) return finish(null);
    const n = frameRowCount(f);
    const passes = (i: number) => crits.every((c) =>
      passesFilter((c.col.values[i] ?? null) as FrameCell, c.op, c.value, c.col.type, c.matchCase));
    // COUNTIFS runs on the criteria alone (Excel takes no values range); the
    // others aggregate the Values column and need it named.
    if (this.op === "countifs") {
      let count = 0;
      for (let i = 0; i < n; i++) if (passes(i)) count++;
      return finish(count);
    }
    const vname = String(inputs.values?.[0] ?? this.stringLiterals.values ?? "").trim();
    if (vname === "") return finish(null); // not written yet
    const vcol = getColumn(f, vname);
    if (!vcol) return finish(solError("#REF!", `No column "${vname}" in the frame`));
    const kept: unknown[] = [];
    for (let i = 0; i < n; i++) if (passes(i)) kept.push(vcol.values[i] ?? null);
    const prep = forAggregate(kept);
    if (prep.error) return finish(prep.error);
    const nums = prep.nums;
    // A values column LOCKED to a dimensional unit (Bundle 05) re-tags the result —
    // sum/avg/min/max all preserve the column's dimension. A no-op for an unlocked
    // column (tagDim collapses a dimensionless tag to a bare number).
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
    // Values dedupe normally (nulls collapse to one), but EVERY error cell
    // survives — deterministically. Identity-dedup is a lottery for errors (three
    // independent failures survive as 3, but one error fanned into three cells
    // collapses to 1); the Excel-user sanity check is "10 values + 3 errors = 3
    // fixes to make". Set-clean output has a sanctioned path (IFERROR/Fill upstream).
    const seen = new Set<unknown>();
    const out: unknown[] = [];
    for (const v of arr) {
      if (isSolError(v)) { out.push(v); continue; }
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    this.cachedList = out as number[];
    return { result: this.cachedList };
  }
}

export type SetOp = "union" | "intersect" | "difference" | "symdiff";

// A complex number is an [re, im] ARRAY, and a JS Set/Map keys an array by
// REFERENCE — so two equal complexes from different sources would never match
// (a known Set-node bug). Key membership by VALUE instead: a complex tuple
// canonicalizes to a string, every primitive (number incl. a date serial,
// string, boolean) stays itself. Used by every Set/membership/tally node below.
function setKey(v: unknown): unknown {
  return Array.isArray(v) ? `\x00cx:${(v as unknown[]).join(",")}` : v;
}

// label = the plain-English dropdown text (no notation — the KaTeX line under the
// selector carries the symbols); tex = the set notation rendered on the card; plain =
// the Unicode fallback shown until the KaTeX chunk loads.
export const SET_OP_META: Record<SetOp, { label: string; tex: string; plain: string }> = {
  union:      { label: "Union: in A or B",             tex: "A \\cup B",                plain: "A ∪ B" },
  intersect:  { label: "Intersection: in both",        tex: "A \\cap B",                plain: "A ∩ B" },
  difference: { label: "Difference: in A, not B",      tex: "A \\setminus B",           plain: "A ∖ B" },
  symdiff:    { label: "Symmetric difference: in one only", tex: "A \\mathbin{\\triangle} B", plain: "A △ B" },
};

// Set operations over two lists — the gap Excel never filled (it ships only UNIQUE, no
// intersect/except/union). "Which customers are in this list but not that one" is one
// dropdown away here. Compares by VALUE, preserving first-seen order and deduping the
// result the way UNIQUE does. Blank (null) cells aren't members and are ignored. An error
// cell is never equal to anything, so it can't match across sides — it passes through
// where it belongs (kept in union, and on the A-side of difference / symmetric difference;
// dropped from intersection) rather than silently vanishing, same stance as UNIQUE.
export class SetOpNode extends ClassicPreset.Node {
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
    this.label = init?.label ?? "Set";
    // Default to the most-asked op (the "in X but not Y" subreddit staple).
    this.op = init?.op ?? "difference";
    this.addInput("a", anyListIn("A"));
    this.addInput("b", anyListIn("B"));
    this.addOutput("result", adoptiveListOut("Result"));
  }

  data(inputs: { a?: unknown[][]; b?: unknown[][] }) {
    // The passthrough declaration keeps UnitCells on a/b; membership keys by
    // display magnitude (the pre-units behavior) — strip before matching.
    const a = stripUnitCells((inputs.a?.[0] ?? []) as unknown[]) as unknown[];
    const b = stripUnitCells((inputs.b?.[0] ?? []) as unknown[]) as unknown[];

    // Value-membership of a side — blanks and errors are excluded (not members).
    const memberSet = (arr: unknown[]) => {
      const s = new Set<unknown>();
      for (const v of arr) if (!isMissing(v) && !isSolError(v)) s.add(setKey(v));
      return s;
    };
    const aSet = memberSet(a);
    const bSet = memberSet(b);

    const out: unknown[] = [];
    const emitted = new Set<unknown>();
    // Values dedupe (first-seen wins); errors bypass this and are pushed as-is, so a
    // repeated error survives once per occurrence — deterministic, like UNIQUE.
    const emitValue = (v: unknown) => { const k = setKey(v); if (!emitted.has(k)) { emitted.add(k); out.push(v); } };

    switch (this.op) {
      case "union":
        for (const v of a) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else emitValue(v); }
        for (const v of b) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else emitValue(v); }
        break;
      case "intersect":
        for (const v of a) { if (isMissing(v) || isSolError(v)) continue; if (bSet.has(setKey(v))) emitValue(v); }
        break;
      case "difference":
        for (const v of a) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else if (!bSet.has(setKey(v))) emitValue(v); }
        break;
      case "symdiff":
        for (const v of a) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else if (!bSet.has(setKey(v))) emitValue(v); }
        for (const v of b) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else if (!aSet.has(setKey(v))) emitValue(v); }
        break;
    }

    this.cachedList = out as number[];
    return { result: this.cachedList };
  }
}

// ─── Is In (membership mask) — Set & Relational pack ─────────────────────────
// Elementwise Contains: for each item of A, TRUE/FALSE whether it appears in B —
// a logical list ALIGNED to A (the Excel `ISNUMBER(MATCH(...))` idiom). Pairs
// with Filter to keep original rows; the scalar Contains node only answers for
// one needle. Membership stance matches the Set node: blank and error cells of
// B aren't members; an A-side blank stays blank (missing propagates), an A-side
// error propagates per cell.
export class IsInNode extends ClassicPreset.Node {
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
    const a = (inputs.a?.[0] ?? []) as unknown[];
    const b = (inputs.b?.[0] ?? []) as unknown[];
    const members = new Set<unknown>();
    for (const v of b) if (!isMissing(v) && !isSolError(v)) members.add(setKey(v));
    const result = a.map((v) => {
      if (isMissing(v)) return null;
      if (isSolError(v)) return v;
      return members.has(setKey(v));
    });
    this.cachedList = result;
    return { result };
  }
}

// ─── Tally (value counts) — Set & Relational pack ─────────────────────────────
// Distinct value → occurrence count, as a two-column Frame — the bare-list
// shortcut for what Group By already does over a frame (Excel: a one-column
// pivot table, or GROUPBY in 365). First-seen order; blank and error cells
// aren't counted (the count is about the real values, same stance as Set).
export class TallyNode extends ClassicPreset.Node {
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
    // Key by value (so equal complexes tally together) but keep the first-seen
    // original value as the row's representative.
    const counts = new Map<unknown, { value: unknown; count: number }>();
    for (const v of list) {
      if (isMissing(v) || isSolError(v)) continue;
      const k = setKey(v);
      const e = counts.get(k);
      if (e) e.count++; else counts.set(k, { value: v, count: 1 });
    }
    const entries = [...counts.values()];
    const values = entries.map((e) => e.value);
    const frame: FrameValue = {
      __frame: true,
      columns: [
        inferColumn("Value", values),
        { name: "Count", type: "number", values: entries.map((e) => e.count) },
      ],
    };
    this.cachedResult = list.length || counts.size ? frame : null;
    return { frame: this.cachedResult };
  }
}

export type SetRelation = "equal" | "subset" | "superset" | "disjoint";

// label = plain-English dropdown text; tex = the KaTeX relation on the card; plain =
// the Unicode fallback shown until the KaTeX chunk loads.
export const SET_RELATION_META: Record<SetRelation, { label: string; tex: string; plain: string }> = {
  equal:    { label: "Equal: same set",         tex: "A = B",                    plain: "A = B" },
  subset:   { label: "Subset: A within B",      tex: "A \\subseteq B",           plain: "A ⊆ B" },
  superset: { label: "Superset: A contains B",  tex: "A \\supseteq B",           plain: "A ⊇ B" },
  disjoint: { label: "Disjoint: no overlap",    tex: "A \\cap B = \\varnothing", plain: "A ∩ B = ∅" },
};

// Set RELATION tests — predicates that answer TRUE/FALSE about two lists as sets. The
// companion to the Set node (which PRODUCES a set): here you ask "are these the same
// set?", "is every A also in B?", "do they share nothing?" — questions Excel makes you
// assemble out of COUNTIF / SUMPRODUCT. Compares by VALUE over each side's distinct
// members; blank (null) and error cells aren't members (same stance as the Set node), so
// the answer is about the real values. Both inputs unwired → null (indeterminate). The
// empty-set edge cases follow set theory: ∅ ⊆ anything, ∅ is disjoint with anything,
// ∅ = ∅.
export class SetRelationNode extends ClassicPreset.Node {
  label: string;
  op: SetRelation;
  cachedResult: Tri = null;
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: SetRelation }) {
    super("SetRelation");
    this.label = init?.label ?? "Set relation";
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

    const memberSet = (arr: unknown[]) => {
      const s = new Set<unknown>();
      for (const v of arr) if (!isMissing(v) && !isSolError(v)) s.add(setKey(v));
      return s;
    };
    const aSet = memberSet((aRaw ?? []) as unknown[]);
    const bSet = memberSet((bRaw ?? []) as unknown[]);
    const subsetOf = (x: Set<unknown>, y: Set<unknown>) => {
      for (const v of x) if (!y.has(v)) return false;
      return true;
    };

    let result = false;
    switch (this.op) {
      case "equal":    result = aSet.size === bSet.size && subsetOf(aSet, bSet); break;
      case "subset":   result = subsetOf(aSet, bSet); break;
      case "superset": result = subsetOf(bSet, aSet); break;
      case "disjoint":
        result = true;
        for (const v of aSet) if (bSet.has(v)) { result = false; break; }
        break;
    }
    this.cachedResult = result;
    return { result };
  }
}

export type TakeDir = "first" | "last";

export class TakeNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  dir: TakeDir;
  cachedList: unknown[] = [];
  literals: Record<string, number> = { count: 1 };
  width = 180;
  height = 170;

  constructor(init?: { label?: string; dir?: TakeDir }) {
    super("Take");
    this.label = init?.label ?? "TAKE";
    this.dir = init?.dir ?? "first";
    this.addInput("list",  adoptiveListIn("List"));
    this.addInput("count", numIn("Count"));
    this.addOutput("result", adoptiveListOut("Result"));
  }

  data(inputs: { list?: unknown[][]; count?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    const n = Math.round(inputs.count?.[0] ?? this.literals.count ?? 1);
    if (n <= 0) { this.cachedList = []; return { result: [] }; }
    this.cachedList = this.dir === "first" ? arr.slice(0, n) : arr.slice(-n);
    return { result: this.cachedList };
  }
}

export type DropDir = "first" | "last";

export class DropNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  dir: DropDir;
  cachedList: unknown[] = [];
  literals: Record<string, number> = { count: 1 };
  width = 180;
  height = 170;

  constructor(init?: { label?: string; dir?: DropDir }) {
    super("Drop");
    this.label = init?.label ?? "DROP";
    this.dir = init?.dir ?? "first";
    this.addInput("list",  adoptiveListIn("List"));
    this.addInput("count", numIn("Count"));
    this.addOutput("result", adoptiveListOut("Result"));
  }

  data(inputs: { list?: unknown[][]; count?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    const n = Math.round(inputs.count?.[0] ?? this.literals.count ?? 1);
    if (n <= 0) { this.cachedList = [...arr]; return { result: this.cachedList }; }
    if (n >= arr.length) { this.cachedList = []; return { result: [] }; }
    this.cachedList = this.dir === "first" ? arr.slice(n) : arr.slice(0, -n);
    return { result: this.cachedList };
  }
}

// Joins lists end-to-end and stays 1-D (VSTACK in matrix.ts is the table
// stacker — appending and stacking are different operations). The 1-D rung of the APPEND
// LADDER (decisions.md D15): N extensible element-agnostic rows (anylist — a
// scalar widens to a 1-element list, so "push one value" needs no wrapper),
// concatenated in row order. Rows are wire-only: a typed literal list belongs
// to List Input, not here.
export class ConcatListsNode extends ClassicPreset.Node {
  /** Element-preserving: the output is exactly the rows' cells in order, so it
   *  adopts the agreed row type (all strlist rows → a strlist out). */
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
    const out: unknown[] = [];
    for (const k of this.valueInputKeys()) {
      const arr = inputs[k]?.[0];
      if (arr != null) out.push(...arr);
    }
    this.cachedList = out;
    return { result: out };
  }
}

export type CumulativeOp = "cumsum" | "cummax" | "cummin" | "cumprod";

export class CumulativeNode extends ClassicPreset.Node {
  label: string;
  op: CumulativeOp;
  cachedList: number[] = [];
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: CumulativeOp }) {
    super("Cumulative");
    this.label = init?.label ?? "Cumulative";
    this.op = init?.op ?? "cumsum";
    this.addInput("list",   listIn("List"));
    this.addOutput("result", listOut("Running"));
  }

  data(inputs: { list?: number[][] }) {
    const arr = inputs.list?.[0] ?? [];
    if (arr.length === 0) { this.cachedList = []; return { result: [] }; }
    const out: number[] = [];
    let acc = this.op === "cumprod" ? 1 : arr[0];
    if (this.op === "cumsum")  acc = 0;
    if (this.op === "cumprod") acc = 1;
    for (const v of arr) {
      switch (this.op) {
        case "cumsum":  acc = (out.length === 0 ? 0 : acc) + v; break;
        case "cummax":  acc = out.length === 0 ? v : Math.max(acc, v); break;
        case "cummin":  acc = out.length === 0 ? v : Math.min(acc, v); break;
        case "cumprod": acc = (out.length === 0 ? 1 : acc) * v; break;
      }
      out.push(acc);
    }
    this.cachedList = out;
    return { result: out };
  }
}

export class DiffNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  width = 180;
  height = 120;

  constructor(init?: { label?: string }) {
    super("Diff");
    this.label = init?.label ?? "DIFF";
    this.addInput("list",   listIn("List"));
    this.addOutput("result", listOut("Differences"));
  }

  data(inputs: { list?: number[][] }) {
    const arr = inputs.list?.[0] ?? [];
    this.cachedList = arr.slice(1).map((v, i) => v - arr[i]);
    return { result: this.cachedList };
  }
}

export type ArgMinMaxOp = "argmax" | "argmin";

export const ARG_MIN_MAX_OP_META = {
  argmax: { label: "ARGMAX", description: "1-based position of the maximum value" },
  argmin: { label: "ARGMIN", description: "1-based position of the minimum value" },
} satisfies Record<ArgMinMaxOp, { label: string; description: string }>;

export class ArgMinMaxNode extends ClassicPreset.Node {
  label: string;
  op: ArgMinMaxOp;
  cachedResult: number | null = null;
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: ArgMinMaxOp }) {
    super("ArgMinMax");
    this.label = init?.label ?? "ARGMAX";
    this.op = init?.op ?? "argmax";
    this.addInput("list",   listIn("List"));
    this.addOutput("result", numOut("Position"));
  }

  data(inputs: { list?: number[][] }) {
    const arr = inputs.list?.[0] ?? null;
    let result: number | null = null;
    if (arr && arr.length > 0) {
      let idx = 0;
      for (let i = 1; i < arr.length; i++) {
        if (this.op === "argmax" ? arr[i] > arr[idx] : arr[i] < arr[idx]) idx = i;
      }
      result = idx + 1; // 1-based
    }
    this.cachedResult = result;
    return { result };
  }
}

export class ContainsNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180;
  height = 160;

  constructor(init?: { label?: string }) {
    super("Contains");
    this.label = init?.label ?? "CONTAINS";
    this.addInput("list",  listIn("List"));
    this.addInput("value", numIn("Value"));
    this.addOutput("result", numOut("0 / 1"));
  }

  data(inputs: { list?: number[][]; value?: number[] }) {
    const arr = inputs.list?.[0] ?? null;
    const v = inputs.value?.[0] ?? this.literals.value ?? null;
    let result: number | null = null;
    if (arr !== null && v !== null) result = arr.includes(v) ? 1 : 0;
    this.cachedResult = result;
    return { result };
  }
}

// ─── Normalize ────────────────────────────────────────────────────────────────
export class NormalizeNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  width = 180; height = 120;

  constructor(init?: { label?: string }) {
    super("Normalize");
    this.label = init?.label ?? "Normalize";
    this.addInput("list",    listIn("List"));
    this.addOutput("result", listOut("0–1"));
  }

  data(inputs: { list?: number[][] }) {
    const arr = inputs.list?.[0] ?? [];
    if (arr.length === 0) { this.cachedList = []; return { result: [] }; }
    const mn = iterMin(arr), mx = iterMax(arr);
    this.cachedList = mn === mx ? arr.map(() => 0) : arr.map(v => (v - mn) / (mx - mn));
    return { result: this.cachedList };
  }
}

// ─── LinSpace ─────────────────────────────────────────────────────────────────
export class LinSpaceNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  literals: Record<string, number> = { start: 0, end: 1, count: 10 };
  width = 180; height = 220;

  constructor(init?: { label?: string }) {
    super("LinSpace");
    this.label = init?.label ?? "LinSpace";
    this.addInput("start", numIn("Start"));
    this.addInput("end",   numIn("End"));
    this.addInput("count", numIn("Count"));
    this.addOutput("result", listOut("List"));
  }

  data(inputs: { start?: number[]; end?: number[]; count?: number[] }) {
    const start = inputs.start?.[0] ?? this.literals.start ?? 0;
    const end   = inputs.end?.[0]   ?? this.literals.end   ?? 1;
    const n     = Math.round(inputs.count?.[0] ?? this.literals.count ?? 10);
    if (n <= 0)  { this.cachedList = []; return { result: [] }; }
    if (n === 1) { this.cachedList = [start]; return { result: [start] }; }
    this.cachedList = Array.from({ length: n }, (_, i) => start + i * (end - start) / (n - 1));
    return { result: this.cachedList };
  }
}

// ─── Repeat ───────────────────────────────────────────────────────────────────
export class RepeatNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  literals: Record<string, number> = { value: 0, count: 5 };
  width = 180; height = 160;

  constructor(init?: { label?: string }) {
    super("Repeat");
    this.label = init?.label ?? "Repeat";
    this.addInput("value", numIn("Value"));
    this.addInput("count", numIn("Count"));
    this.addOutput("result", listOut("List"));
  }

  data(inputs: { value?: number[]; count?: number[] }) {
    const v = inputs.value?.[0] ?? this.literals.value ?? 0;
    const n = Math.max(0, Math.round(inputs.count?.[0] ?? this.literals.count ?? 5));
    this.cachedList = Array(n).fill(v);
    return { result: this.cachedList };
  }
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────
export class ShuffleNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  cachedList: unknown[] = [];
  width = 180; height = 150;
  // Volatile: the random order is fixed until a recalc (or the input length
  // changes), so editing an unrelated node doesn't reshuffle. We keep per-slot
  // sort keys rather than a fixed permutation so live input values flow through.
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
    const order = arr
      .map((v, i) => ({ v, k: this.keys[i] }))
      .sort((a, b) => a.k - b.k)
      .map((p) => p.v);
    this.cachedList = order;
    return { result: order };
  }
}

// ─── NthElement ───────────────────────────────────────────────────────────────
export class NthElementNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  cachedList: unknown[] = [];
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
    const n = Math.max(1, Math.round(inputs.n?.[0] ?? this.literals.n ?? 2));
    this.cachedList = arr.filter((_, i) => i % n === 0);
    return { result: this.cachedList };
  }
}

// ─── Interleave ───────────────────────────────────────────────────────────────
export class InterleaveNode extends ClassicPreset.Node {
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
    // Ragged inputs pad to the LONGEST with null so the A/B alternation stays
    // aligned and no tail element is silently dropped.
    const n = Math.max(a.length, b.length);
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) {
      out.push(i < a.length ? a[i] : null, i < b.length ? b[i] : null);
    }
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
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["list"], combine: "single" }];
  label: string;
  dir: PadDir;
  cachedList: unknown[] = [];
  literals: Record<string, number> = { n: 5, fill: 0 };
  width = 180; height = 230;

  constructor(init?: { label?: string; dir?: PadDir }) {
    super("Pad");
    this.label = init?.label ?? "Pad";
    this.dir = init?.dir ?? "right";
    this.addInput("list", adoptiveListIn("List"));
    this.addInput("n",    numIn("Target length"));
    this.addInput("fill", numIn("Fill value"));
    this.addOutput("result", adoptiveListOut("Padded"));
  }

  data(inputs: { list?: unknown[][]; n?: number[]; fill?: number[] }) {
    const arr  = inputs.list?.[0] ?? [];
    const n    = Math.round(inputs.n?.[0] ?? this.literals.n ?? 5);
    const fill = inputs.fill?.[0] ?? this.literals.fill ?? 0;
    if (arr.length >= n) { this.cachedList = arr; return { result: arr }; }
    const pad = Array(n - arr.length).fill(fill);
    this.cachedList = this.dir === "left" ? [...pad, ...arr] : [...arr, ...pad];
    return { result: this.cachedList };
  }
}

// ─── Geometric Sequence ───────────────────────────────────────────────────────
export class GeometricNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  literals: Record<string, number> = { start: 1, ratio: 2, count: 8 };
  width = 180; height = 220;

  constructor(init?: { label?: string }) {
    super("Geometric");
    this.label = init?.label ?? "Geometric";
    this.addInput("start", numIn("Start"));
    this.addInput("ratio", numIn("Ratio"));
    this.addInput("count", numIn("Count"));
    this.addOutput("result", listOut("Series"));
  }

  data(inputs: { start?: number[]; ratio?: number[]; count?: number[] }) {
    const start = inputs.start?.[0] ?? this.literals.start ?? 1;
    const ratio = inputs.ratio?.[0] ?? this.literals.ratio ?? 2;
    const n     = Math.max(0, Math.round(inputs.count?.[0] ?? this.literals.count ?? 8));
    const out: number[] = [];
    let v = start;
    for (let i = 0; i < n; i++) { out.push(v); v *= ratio; }
    this.cachedList = out;
    return { result: out };
  }
}

// ─── Fibonacci ────────────────────────────────────────────────────────────────
export class FibonacciNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  literals: Record<string, number> = { n: 10 };
  width = 180; height = 130;

  constructor(init?: { label?: string }) {
    super("Fibonacci");
    this.label = init?.label ?? "Fibonacci";
    this.addInput("n",       numIn("Count"));
    this.addOutput("result", listOut("Sequence"));
  }

  data(inputs: { n?: number[] }) {
    const count = Math.min(78, Math.max(0, Math.round(inputs.n?.[0] ?? this.literals.n ?? 10)));
    if (count === 0) { this.cachedList = []; return { result: [] }; }
    const out = [1];
    if (count > 1) { out.push(1); }
    for (let i = 2; i < count; i++) out.push(out[i - 1] + out[i - 2]);
    this.cachedList = out;
    return { result: out };
  }
}

// ─── Rolling Window ───────────────────────────────────────────────────────────

export type RollingOp = "sum" | "avg" | "min" | "max" | "stdev" | "median";

export const ROLLING_OP_META = {
  sum:    { label: "Rolling SUM",    description: "Sliding-window sum over the list" },
  avg:    { label: "Rolling AVG",    description: "Sliding-window average" },
  min:    { label: "Rolling MIN",    description: "Sliding-window minimum" },
  max:    { label: "Rolling MAX",    description: "Sliding-window maximum" },
  stdev:  { label: "Rolling STDEV", description: "Sliding-window sample standard deviation; divides by n−1" },
  median: { label: "Rolling MEDIAN",description: "Sliding-window median" },
} satisfies Record<RollingOp, { label: string; description: string }>;

export class RollingNode extends ClassicPreset.Node {
  label: string;
  op: RollingOp;
  cachedList: (number | null | SolError)[] = [];
  literals: Record<string, number> = { window: 3 };
  width = 180;
  height = 210;

  constructor(init?: { label?: string; op?: RollingOp }) {
    super("Rolling");
    this.label = init?.label ?? "Rolling";
    this.op = init?.op ?? "sum";
    this.addInput("list",   listIn("List"));
    this.addInput("window", numIn("Window size"));
    this.addOutput("result", listOut("Result"));
  }

  data(inputs: { list?: (number | null | SolError)[][]; window?: number[] }) {
    const arr = inputs.list?.[0] ?? [];
    const w   = Math.max(1, Math.round(inputs.window?.[0] ?? this.literals.window ?? 3));
    // Each window runs through forAggregate like every other reducer (audit
    // finding 14): a per-cell error propagates into THAT output cell (a blind
    // `a+b` reduce concatenated the error object into a string), a null is
    // skipped (it counted as 0 and still divided the average by the full
    // window). An all-null window: sum 0, everything else null.
    const result: (number | null | SolError)[] = arr.map((_, i) => {
      const prep = forAggregate(arr.slice(Math.max(0, i - w + 1), i + 1));
      if (prep.error) return prep.error;
      const nums = prep.nums.filter((n) => Number.isFinite(n));
      if (nums.length === 0) return this.op === "sum" ? 0 : null;
      switch (this.op) {
        case "sum": return nums.reduce((a, b) => a + b, 0);
        case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
        case "min": return iterMin(nums);
        case "max": return iterMax(nums);
        case "stdev": {
          if (nums.length < 2) return null; // sample stdev undefined (matches var_s)
          const m = nums.reduce((a, b) => a + b, 0) / nums.length;
          return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / (nums.length - 1));
        }
        case "median": {
          const sorted = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
        }
      }
    });
    this.cachedList = result;
    return { result };
  }
}

// ─── Weighted Statistics ──────────────────────────────────────────────────────

export type WeightedOp = "wavg" | "wvar" | "wstdev";

export const WEIGHTED_OP_META = {
  wavg:   { label: "WAVG",   description: "Weighted average: Σ(x·w) / Σw. Excel: SUMPRODUCT(x,w)/SUM(w)." },
  wvar:   { label: "WVAR",   description: "Weighted sample variance with reliability weights" },
  wstdev: { label: "WSTDEV", description: "Weighted sample standard deviation: √WVAR" },
} satisfies Record<WeightedOp, { label: string; description: string }>;

export class WeightedNode extends ClassicPreset.Node {
  label: string;
  op: WeightedOp;
  cachedResult: number | SolError | null = null;
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: WeightedOp }) {
    super("Weighted");
    this.label = init?.label ?? "WAVG";
    this.op    = init?.op    ?? "wavg";
    this.addInput("values",  listIn("Values"));
    this.addInput("weights", listIn("Weights"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { values?: (number | null | SolError)[][]; weights?: (number | null | SolError)[][] }) {
    const values  = inputs.values?.[0]  ?? null;
    const weights = inputs.weights?.[0] ?? null;
    // A SolError in either list propagates.
    for (const v of [...(values ?? []), ...(weights ?? [])]) if (isSolError(v)) { this.cachedResult = v; return { result: v }; }
    let result: number | null = null;
    if (values && weights && values.length > 0 && weights.length >= values.length) {
      // Pair value↔weight by position; SKIP a pair if either side is null (missing).
      const pairs: [number, number][] = [];
      for (let i = 0; i < values.length; i++) {
        const v = values[i], w = weights[i];
        if (!isMissing(v) && !isMissing(w)) pairs.push([v as number, w as number]);
      }
      const wSum = pairs.reduce((a, [, w]) => a + w, 0);
      if (pairs.length > 0 && wSum !== 0) {
        const wavg = pairs.reduce((s, [v, w]) => s + v * w, 0) / wSum;
        if (this.op === "wavg") {
          result = wavg;
        } else {
          // Bessel-corrected reliability-weight variance: Σw·(x−μ)² / (Σw − Σw²/Σw)
          const wSum2 = pairs.reduce((a, [, w]) => a + w * w, 0);
          const denom = wSum - wSum2 / wSum;
          if (denom > 0) {
            const wvar = pairs.reduce((s, [v, w]) => s + w * (v - wavg) ** 2, 0) / denom;
            result = this.op === "wvar" ? wvar : Math.sqrt(wvar);
          }
        }
        if (result !== null && !Number.isFinite(result)) result = null;
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Reduce ───────────────────────────────────────────────────────────────────

export type ReduceOp =
  | "sum" | "avg" | "min" | "max" | "count" | "countdistinct" | "median" | "product" | "stdev"
  | "geomean" | "harmean" | "sumsq" | "var_s" | "var_p" | "stdev_p" | "devsq" | "avedev" | "skew" | "skew_p" | "kurt";

export const REDUCE_OP_META = {
  sum:     { label: "SUM",     description: "Sum all values. Excel: SUM." },
  avg:     { label: "AVERAGE", description: "Arithmetic mean. Excel: AVERAGE." },
  min:     { label: "MIN",     description: "Smallest value. Excel: MIN." },
  max:     { label: "MAX",     description: "Largest value. Excel: MAX." },
  count:   { label: "COUNT",   description: "Number of values. Excel: COUNT." },
  countdistinct: { label: "COUNT DISTINCT", description: "Number of unique values. In Excel you'd write COUNTA(UNIQUE(range))." },
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
  skew_p:  { label: "SKEW.P",  description: "Population skewness; divides by n. Excel: SKEW.P." },
  kurt:    { label: "KURT",    description: "Excess kurtosis of the distribution. Excel: KURT." },
} satisfies Record<ReduceOp, { label: string; description: string }>;

// NB: the user-facing identity is "Aggregate" (header title, hover type hint via
// constructor.name, status bar). It is NOT the table-taking REDUCE lambda
// (`ReduceLambdaNode`) — it's a fixed-op 1-D list aggregator (SUM/AVERAGE/MEDIAN/
// STDEV/…), so its input is a `list`, not a `table`. The internal op tokens
// (`ReduceOp`, `REDUCE_OP_META`, the `reduce-${op}` catalog ids) keep the
// `reduce` prefix — never user-visible.
// How an aggregate transforms the shared dimension of its inputs (Bundle 05, step 6):
//   preserve (sum/avg/min/max/median/geomean/harmean/stdev/spread) → same dim ·
//   square (var/devsq/sumsq) → dim² · product → dimⁿ · everything else (count,
//   normalized moments) → dimensionless. `n` = the number of aggregated cells.
export function aggregateResultDim(op: ReduceOp, dim: Dim, n: number): Dim {
  if (isDimensionless(dim)) return DIMENSIONLESS;
  switch (op) {
    case "sum": case "avg": case "min": case "max": case "median":
    case "geomean": case "harmean": case "stdev": case "stdev_p": case "avedev":
      return dim;
    case "var_s": case "var_p": case "devsq": case "sumsq":
      return dimPow(dim, 2);
    case "product":
      return dimPow(dim, n);
    default: // count, countdistinct, skew, skew_p, kurt → a plain number
      return DIMENSIONLESS;
  }
}

export class AggregateNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs — runs the dimension algebra itself (FC A4; see coerceInputs). */
  unitAware = true;
  label: string;
  op: ReduceOp;
  cachedResult: number | UnitCell | SolError | null = null;
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: ReduceOp }) {
    super("Aggregate");
    this.label = init?.label ?? "Aggregate";
    this.op = init?.op ?? "sum";
    this.addInput("list",    listIn("List"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { list?: (number | null | SolError)[][] }) {
    // Aggregator policy: a SolError in the list PROPAGATES; `null` (missing) is
    // SKIPPED; a DIMENSIONLESS cell (a bare number) ADOPTS the list's real unit
    // (SUM($5, $2, 3) = $10), and only two genuinely different real dimensions are a
    // #UNIT!. Base-SI storage means commensurable-but-differently-authored cells
    // (km + m) are already unified — no conversion step. No-op for all-number lists
    // (dim = dimensionless → the result re-tags to a bare number, unchanged).
    const prep = forAggregateUnits(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    const arr = prep.nums;
    const dim = prep.dim;
    let result: number | null = null;
    if (arr.length > 0) {
      switch (this.op) {
        case "sum":     result = arr.reduce((a, b) => a + b, 0); break;
        case "avg":     result = arr.reduce((a, b) => a + b, 0) / arr.length; break;
        case "min":     result = iterMin(arr); break;
        case "max":     result = iterMax(arr); break;
        case "count":   result = arr.length; break;
        case "countdistinct": result = new Set(arr).size; break;
        case "product": result = arr.reduce((a, b) => a * b, 1); break;
        case "median": {
          const s = [...arr].sort((a, b) => a - b);
          const m = Math.floor(s.length / 2);
          result = s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
          break;
        }
        case "stdev": {
          if (arr.length < 2) break; // sample stdev undefined under 2 points — blank, like var_s (audit finding 30)
          const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
          const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
          result = Math.sqrt(variance);
          break;
        }
        case "geomean": {
          if (arr.some((v) => v <= 0)) break;
          result = Math.exp(arr.reduce((a, b) => a + Math.log(b), 0) / arr.length);
          break;
        }
        case "harmean": {
          if (arr.some((v) => v <= 0)) break;
          result = arr.length / arr.reduce((a, b) => a + 1 / b, 0);
          break;
        }
        case "sumsq":   result = arr.reduce((a, b) => a + b * b, 0); break;
        case "var_s": {
          if (arr.length < 2) break;
          const meanVs = arr.reduce((a, b) => a + b, 0) / arr.length;
          result = arr.reduce((a, b) => a + (b - meanVs) ** 2, 0) / (arr.length - 1);
          break;
        }
        case "var_p": {
          const meanVp = arr.reduce((a, b) => a + b, 0) / arr.length;
          result = arr.reduce((a, b) => a + (b - meanVp) ** 2, 0) / arr.length;
          break;
        }
        case "stdev_p": {
          const meanSp = arr.reduce((a, b) => a + b, 0) / arr.length;
          result = Math.sqrt(arr.reduce((a, b) => a + (b - meanSp) ** 2, 0) / arr.length);
          break;
        }
        case "devsq": {
          const meanDq = arr.reduce((a, b) => a + b, 0) / arr.length;
          result = arr.reduce((a, b) => a + (b - meanDq) ** 2, 0);
          break;
        }
        case "avedev": {
          const meanAd = arr.reduce((a, b) => a + b, 0) / arr.length;
          result = arr.reduce((a, b) => a + Math.abs(b - meanAd), 0) / arr.length;
          break;
        }
        case "skew": {
          const nSk = arr.length;
          if (nSk < 3) break;
          const meanSk = arr.reduce((a, b) => a + b, 0) / nSk;
          const sSk = Math.sqrt(arr.reduce((a, b) => a + (b - meanSk) ** 2, 0) / (nSk - 1));
          if (sSk === 0) break;
          const sum3 = arr.reduce((a, b) => a + ((b - meanSk) / sSk) ** 3, 0);
          result = (nSk / ((nSk - 1) * (nSk - 2))) * sum3;
          break;
        }
        case "skew_p": {
          const nSp = arr.length;
          if (nSp < 2) break;
          const meanSp = arr.reduce((a, b) => a + b, 0) / nSp;
          const sSp = Math.sqrt(arr.reduce((a, b) => a + (b - meanSp) ** 2, 0) / nSp);
          if (sSp === 0) break;
          result = arr.reduce((a, b) => a + ((b - meanSp) / sSp) ** 3, 0) / nSp;
          break;
        }
        case "kurt": {
          const nKu = arr.length;
          if (nKu < 4) break;
          const meanKu = arr.reduce((a, b) => a + b, 0) / nKu;
          const sKu = Math.sqrt(arr.reduce((a, b) => a + (b - meanKu) ** 2, 0) / (nKu - 1));
          if (sKu === 0) break;
          const sum4 = arr.reduce((a, b) => a + ((b - meanKu) / sKu) ** 4, 0);
          result =
            ((nKu * (nKu + 1)) / ((nKu - 1) * (nKu - 2) * (nKu - 3))) * sum4 -
            (3 * (nKu - 1) ** 2) / ((nKu - 2) * (nKu - 3));
          break;
        }
      }
    } else if (this.op === "count" || this.op === "sum") {
      // Empty/all-null input: SUM is 0 and PRODUCT is 1 (the additive/multiplicative
      // identities — matching the formula path and aggregateGroup; audit finding 30).
      result = 0;
    } else if (this.op === "product") {
      result = 1;
    }
    // Re-tag the reduced magnitude with the op's result dimension (a no-op for
    // dimensionless data — tagDim collapses it back to a bare number). Keep the
    // display unit only when the op PRESERVES the dimension (SUM/AVG/MIN/MAX of $ →
    // $), not when it changes it (PRODUCT/SUMSQ/VAR derive a new dim).
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

// Upper bound on a generated list's length. A generator asked for an absurd count
// (a typo, or a wired value) would otherwise allocate an enormous array that
// freezes the UI; cap it and return #OVERFLOW! (count out of range) instead.
const MAX_GENERATED = 1_000_000;

export class RandArrayNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] | SolError = [];
  literals: Record<string, number> = { count: 10 }; // min/max ship unset → muted 0/1 placeholders
  width = 180; height = 225;
  // Volatile: raw [0,1) rolls are fixed until a recalc (or the count changes);
  // min/max are applied live so wiring new bounds rescales the same draws.
  private rolls: number[] = [];
  private lastGen = -1;

  constructor(init?: { label?: string }) {
    super("RandArray");
    this.label = init?.label ?? "RANDARRAY";
    this.addInput("count", numIn("Count"));
    this.addInput("min",   numIn("Min (default 0)"));
    this.addInput("max",   numIn("Max (default 1)"));
    this.addOutput("list", listOut("List"));
  }

  data(inputs: { count?: number[]; min?: number[]; max?: number[] }): { list: number[] | SolError } {
    const count = Math.max(0, Math.floor(inputs.count?.[0] ?? this.literals.count ?? 10));
    if (count > MAX_GENERATED) {
      const e = solError("#OVERFLOW!", `RANDARRAY count ${count} exceeds the ${MAX_GENERATED} element limit`);
      this.cachedList = e; this.rolls = []; this.lastGen = -1;
      return { list: e };
    }
    const lo    = inputs.min?.[0] ?? this.literals.min ?? 0;
    const hi    = inputs.max?.[0] ?? this.literals.max ?? 1;
    const range = hi - lo;
    const gen = getRecalcGen();
    if (this.lastGen !== gen || this.rolls.length !== count) {
      this.rolls = Array.from({ length: count }, () => Math.random());
      this.lastGen = gen;
    }
    const list = this.rolls.map((r) => lo + r * range);
    this.cachedList = list;
    return { list };
  }
}

// ─── SEQUENCE ─────────────────────────────────────────────────────────────────

export class SequenceNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] | SolError = [];
  literals: Record<string, number> = { count: 10 }; // start/step ship unset → muted 1/1 placeholders
  width = 180; height = 195;

  constructor(init?: { label?: string }) {
    super("Sequence");
    this.label = init?.label ?? "SEQUENCE";
    this.addInput("count", numIn("Count"));
    this.addInput("start", numIn("Start (default 1)"));
    this.addInput("step",  numIn("Step (default 1)"));
    this.addOutput("list", listOut("List"));
  }

  data(inputs: { count?: number[]; start?: number[]; step?: number[] }): { list: number[] | SolError } {
    const count = Math.max(0, Math.floor(inputs.count?.[0] ?? this.literals.count ?? 10));
    if (count > MAX_GENERATED) {
      const e = solError("#OVERFLOW!", `SEQUENCE count ${count} exceeds the ${MAX_GENERATED} element limit`);
      this.cachedList = e;
      return { list: e };
    }
    const start = inputs.start?.[0] ?? this.literals.start ?? 1;
    const step  = inputs.step?.[0]  ?? this.literals.step  ?? 1;
    const list  = Array.from({ length: count }, (_, i) => start + i * step);
    this.cachedList = list;
    return { list };
  }
}

// ─── SORTBY ───────────────────────────────────────────────────────────────────

export class SortByNode extends ClassicPreset.Node {
  /** Element-preserving reorder: the output adopts the sorted array's type (the
   *  by_array keys are a side input — not in the spec, so they stay unit-blind
   *  numbers for the comparison). */
  passthrough = (): PassthroughSpec[] => [{ output: "list", inputs: ["array"], combine: "single" }];
  label: string;
  cachedList: unknown[] = [];
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("SortBy");
    this.label = init?.label ?? "SORTBY";
    // The array being reordered is POSITION-ONLY (element-agnostic, `anylist` per
    // the D15 sweep) — so a text/date/logical list sorts by a parallel key too
    // ("names by scores"). Only the by_array keys drive comparison, so they stay
    // numeric (widening those to text keys is the deferred string-ordering call).
    this.addInput("array",    anyListIn("Array to sort"));
    this.addInput("by_array", listIn("Sort by (parallel list)"));
    this.addOutput("list", adoptiveListOut("Sorted list"));
  }

  data(inputs: { array?: unknown[][]; by_array?: (number | null | SolError)[][] }): { list: unknown[] } {
    const arr = inputs.array?.[0] ?? [];
    const by  = inputs.by_array?.[0] ?? [];
    // Ragged inputs pad to the LONGEST with null (never silently drop a value);
    // a null/error KEY sends its row to the tail, stably, matching the frame
    // sort's blanks-last policy — so a value whose key is missing still comes
    // through, just last.
    const n = Math.max(arr.length, by.length);
    const isTail = (v: unknown) => isMissing(v) || isSolError(v);
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((i, j) => {
      const ki = i < by.length ? by[i] : null, kj = j < by.length ? by[j] : null;
      const ti = isTail(ki), tj = isTail(kj);
      if (ti || tj) return ti && tj ? i - j : ti ? 1 : -1; // tail last, stable
      const c = (ki as number) - (kj as number);
      return c !== 0 ? c : i - j; // stable on ties
    });
    const list = idx.map((i) => (i < arr.length ? arr[i] : null));
    this.cachedList = list;
    return { list };
  }
}

// ─── XMATCH ───────────────────────────────────────────────────────────────────

export type XMatchMatchMode = "exact" | "next_larger" | "next_smaller";

export const XMATCH_MATCH_MODE_META: Record<XMatchMatchMode, string> = {
  exact:        "Exact match (0)",
  next_larger:  "Exact or next larger (1)",
  next_smaller: "Exact or next smaller (-1)",
};

export class XMatchNode extends ClassicPreset.Node {
  label: string;
  matchMode: XMatchMatchMode;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180; height = 200;

  constructor(init?: { label?: string; matchMode?: XMatchMatchMode }) {
    super("XMatch");
    this.label     = init?.label     ?? "XMATCH";
    this.matchMode = init?.matchMode ?? "exact";
    this.addInput("value",  numIn("Lookup value"));
    this.addInput("array",  listIn("Array"));
    this.addOutput("result", numOut("1-based position (#N/A when not found)"));
  }

  data(inputs: { value?: number[]; array?: number[][] }): { result: number | SolError | null } {
    const val = inputs.value?.[0] ?? this.literals.value ?? 0;
    const wired = inputs.array?.[0] ?? null;
    const arr = wired ?? [];
    let result: number | SolError | null = null;
    if (this.matchMode === "exact") {
      const idx = arr.findIndex(v => v === val);
      result = idx === -1 ? null : idx + 1;
    } else if (this.matchMode === "next_larger") {
      let best: number | null = null; let bestIdx = -1;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] >= val && (best === null || arr[i] < best)) { best = arr[i]; bestIdx = i; }
      }
      result = bestIdx === -1 ? null : bestIdx + 1;
    } else {
      let best: number | null = null; let bestIdx = -1;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] <= val && (best === null || arr[i] > best)) { best = arr[i]; bestIdx = i; }
      }
      result = bestIdx === -1 ? null : bestIdx + 1;
    }
    // A wired array with no match is Excel #N/A; an unwired array stays blank.
    if (wired !== null && result === null) {
      result = solError("#N/A", "No match found in the array");
    }
    this.cachedResult = result;
    return { result };
  }
}

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
  /** The unique-keys output is a SUBSET of the keys input (first occurrences),
   *  so it adopts the keys' element type; the aggregated values stay numeric. */
  passthrough = (): PassthroughSpec[] => [{ output: "keys", inputs: ["keys"], combine: "single" }];
  label: string;
  op: GroupByOp;
  cachedKeys: (string | number)[] | null = null;
  cachedValues: number[] | null = null;
  width = 180; height = 220;

  constructor(init?: { label?: string; op?: GroupByOp }) {
    super("GroupBy");
    this.label = init?.label ?? "Group Lists";
    this.op    = init?.op    ?? "sum";
    this.addInput("keys",   anyListIn("Keys"));
    this.addInput("values", listIn("Values"));
    this.addOutput("keys",   adoptiveListOut("Unique keys"));
    this.addOutput("values", listOut("Aggregated"));
  }

  data(inputs: {
    keys?:   unknown[][];
    values?: number[][];
  }): { keys: (string | number)[]; values: number[] } {
    // The passthrough declaration keeps UnitCells on `keys`; grouping keys by
    // String(cell) — strip to display magnitudes first (the pre-units behavior)
    // so a tagged key list still buckets by value, not object identity.
    const rawKeys = stripUnitCells(inputs.keys?.[0]) as unknown[] | undefined;
    const rawVals = inputs.values?.[0] ?? [];

    if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
      this.cachedKeys = null;
      this.cachedValues = null;
      return { keys: [], values: [] };
    }

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
    this.cachedKeys   = order;
    this.cachedValues = aggValues;
    return { keys: order, values: aggValues };
  }
}

// ─── Coalesce / Fill ────────────────────────────────────────────────────────────
// The explicit opt-in to "treat `null` as something" — the inverse of the skip-null
// aggregators. One bundled node (op dropdown, like Aggregate) for missing-value
// handling. A per-cell SolError is NOT missing, so every mode passes errors through
// untouched (it FILLS gaps, it doesn't repair errors); statistics impute from the
// PRESENT finite numbers only (skip null AND error). See dev-notes "Coalesce / Fill".

export type FillOp =
  | "constant" | "ffill" | "bfill"
  | "mean" | "median" | "mode"
  | "interpolate" | "drop" | "coalesce";

export const FILL_OP_META = {
  constant:    { label: "Fill with value",  description: "Replace each missing (null) cell with a constant. Excel: IF(ISBLANK, …)." },
  ffill:       { label: "Forward fill",      description: "Carry the last present value forward over gaps. Pandas: ffill." },
  bfill:       { label: "Backward fill",     description: "Carry the next present value back over gaps. Pandas: bfill." },
  mean:        { label: "Fill with mean",    description: "Impute gaps with the mean of present values" },
  median:      { label: "Fill with median",  description: "Impute gaps with the median of present values" },
  mode:        { label: "Fill with mode",    description: "Impute gaps with the most common present value" },
  interpolate: { label: "Interpolate",       description: "Linearly interpolate interior gaps between bracketing present values" },
  drop:        { label: "Drop missing",      description: "Remove missing (null) cells, shortening the list. Pandas: dropna." },
  coalesce:    { label: "Coalesce (else)",   description: "First present of List then each Else in order, per position. SQL: COALESCE." },
} satisfies Record<FillOp, { label: string; description: string }>;

type Cell = number | null | SolError;

/** Present finite numbers only — gaps (null) and per-cell errors are excluded, so
 *  an imputation statistic is computed from real data (per P3 skip-null). */
function presentNumbers(arr: ReadonlyArray<Cell>): number[] {
  return arr.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function imputeStat(arr: ReadonlyArray<Cell>, op: "mean" | "median" | "mode"): number | null {
  const nums = presentNumbers(arr);
  if (nums.length === 0) return null; // nothing present → can't impute, leave gaps null
  if (op === "mean") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === "median") {
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }
  // mode: most frequent; ties broken by first occurrence (Excel MODE behavior).
  const counts = new Map<number, number>();
  let best = nums[0], bestCount = 0;
  for (const v of nums) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) { bestCount = c; best = v; }
  }
  return best;
}

/** Linear interpolation of interior gaps: each null between two present finite
 *  numbers is filled along the straight line by index. Leading/trailing gaps (no
 *  bracket on one side) stay null — no extrapolation. A non-finite/error cell is a
 *  hard boundary (not a value to interpolate from), so gaps beside it stay null. */
function interpolateList(arr: ReadonlyArray<Cell>): Cell[] {
  const out: Cell[] = arr.slice();
  let i = 0;
  while (i < out.length) {
    if (!isMissing(out[i])) { i++; continue; }
    // run of nulls [start, end)
    const start = i;
    while (i < out.length && isMissing(out[i])) i++;
    const end = i;
    const left = start - 1;
    const right = end;
    const lv = left >= 0 ? out[left] : undefined;
    const rv = right < out.length ? out[right] : undefined;
    if (typeof lv === "number" && Number.isFinite(lv) && typeof rv === "number" && Number.isFinite(rv)) {
      const span = right - left;
      for (let k = start; k < end; k++) {
        const t = (k - left) / span;
        out[k] = lv + (rv - lv) * t;
      }
    } // else: an open-ended or error-bounded gap — leave the nulls in place
  }
  return out;
}

export class FillNode extends ClassicPreset.Node {
  label: string;
  op: FillOp;
  cachedList: Cell[] = [];
  literals: Record<string, number> = { value: 0 };
  nextInputId = 0;
  width = 200; height = 175;

  constructor(init?: { label?: string; op?: FillOp; valueKeys?: string[] }) {
    super("Fill");
    this.label = init?.label ?? "Fill";
    this.op = init?.op ?? "constant";
    this.addInput("list",  listIn("List"));
    this.addInput("value", numIn("Fill with")); // shown for the constant mode
    // Coalesce fallbacks: extensible "Else" rows (e0, e1, …) — full N-ary
    // COALESCE, shown for the coalesce mode. extractInit's valueKeys snapshot
    // includes the fixed inputs; filter to the keys this node owns (the CHOOSE
    // convention).
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

  // The missing-value sibling of IFERROR (the 2×2: detect × recover), so it passes
  // units the same way: coalesce agrees across the list + its Else fallbacks; every
  // other fill mode fills FROM the list's own values (or a dimensionless constant),
  // so the list's unit rides through. Not `pure` — cells do change.
  passthrough(): PassthroughSpec[] {
    return this.op === "coalesce"
      ? [{ output: "result", inputs: ["list", ...this.elseKeys()], combine: "agree" }]
      : [{ output: "result", inputs: ["list"], combine: "single" }];
  }

  data(inputs: { list?: Cell[][]; value?: number[] } & Record<string, Cell[][] | number[] | undefined>) {
    const arr = inputs.list?.[0] ?? null;
    if (!arr) { this.cachedList = []; return { result: [] }; }
    let out: Cell[];
    switch (this.op) {
      case "constant": {
        const c = inputs.value?.[0] ?? this.literals.value ?? 0;
        out = arr.map((v) => (isMissing(v) ? c : v));
        break;
      }
      case "ffill": {
        out = [];
        let last: Cell = null;
        let have = false;
        for (const v of arr) {
          if (isMissing(v)) out.push(have ? last : null);
          else { last = v; have = true; out.push(v); }
        }
        break;
      }
      case "bfill": {
        out = new Array<Cell>(arr.length).fill(null);
        let next: Cell = null;
        let have = false;
        for (let i = arr.length - 1; i >= 0; i--) {
          const v = arr[i];
          if (isMissing(v)) out[i] = have ? next : null;
          else { next = v; have = true; out[i] = v; }
        }
        break;
      }
      case "mean": case "median": case "mode": {
        const stat = imputeStat(arr, this.op);
        out = arr.map((v) => (isMissing(v) ? stat : v));
        break;
      }
      case "interpolate": {
        out = interpolateList(arr);
        break;
      }
      case "drop": {
        out = arr.filter((v) => !isMissing(v));
        break;
      }
      case "coalesce": {
        // N-ary: List first, then each Else row in order. A wired row
        // contributes its list (a longer one EXTENDS the output, matching the
        // old 2-source behavior); an unwired row with a typed literal is a
        // broadcast constant (the last-resort-default idiom, doesn't extend);
        // an untouched row contributes nothing.
        const fallbacks: (Cell[] | number | null)[] = this.elseKeys().map((k) => {
          const wired = (inputs[k] as Cell[][] | undefined)?.[0];
          if (Array.isArray(wired)) return wired;
          if (k in inputs) return null; // wired but empty — contributes nothing
          const lit = this.literals[k];
          return typeof lit === "number" ? lit : null;
        });
        const lists = fallbacks.filter((f): f is Cell[] => Array.isArray(f));
        const n = Math.max(arr.length, ...lists.map((s) => s.length));
        out = Array.from({ length: n }, (_, i): Cell => {
          const first: Cell = i < arr.length ? arr[i] : null;
          if (!isMissing(first)) return first;
          for (const f of fallbacks) {
            if (f === null) continue;
            const v: Cell = typeof f === "number" ? f : i < f.length ? f[i] : null;
            if (!isMissing(v)) return v;
          }
          return null;
        });
        break;
      }
    }
    this.cachedList = out;
    return { result: out };
  }
}
