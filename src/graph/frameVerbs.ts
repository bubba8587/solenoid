// [[C45]] excelComparisons, [[C16]] polarsEngine, [[C24]] arraySemantics, [[D48]] classifyNonFinite, [[D49]] textPredicateNeedsText
import {
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
  type CubeValue, type CubeColumn, type CubeCell,
  frameRowCount, makeHeaders, cubeFromColumns, cubeRowCount, inferColumn, isFrameValue,
  isCubeValue, frameFromRows, formatFrameCell, selectCubeRows, cubeCellsFromColumn, roundAtLargerTerm,
} from "./frame";
import { isSolError, solError } from "./errorValue";
import { sameColumnUnit, isAffineDisplay, unitError, READINGS_ADD, READINGS_SCALE, type ColumnUnit } from "./unitValue";
import { dimEqual, dimPow, formatDim } from "./dimension";
import { fcUnitToUnit } from "./unitBridge";
import { forAggregate, coerceLogical, guardFinite, decimalFromText } from "./valueKinds";
import { compareStrings } from "./stringOrder";
import { compareOp, type ComparisonOp } from "./nodes/logic";
import { xmatchIndex, type XMatchMatchMode } from "./nodes/listOps";
import { allocate, type AllocateMode } from "./nodes/allocateOps";
import { aggregate, percentile, pearson, spearman, kendallTau, covariance } from "./nodes/statsOps";
import { parseDateToSerial } from "./nodes/dateSerial";

export type AggOp =
  | "sum" | "avg" | "min" | "max" | "count"
  | "product" | "median" | "mode" | "stdev" | "stdevp" | "var" | "varp"
  | "percentof";

export type FilterOp =
  | ComparisonOp | "contains" | "startsWith" | "endsWith" | "isblank" | "notblank" | "iserror" | "noterror"
  | "listContains" | "listContainsAny" | "listContainsAll" | "listEmpty";

export const VALUELESS_FILTER_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>(["isblank", "notblank", "iserror", "noterror", "listEmpty"]);

export const LIST_FILTER_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>(["listContains", "listContainsAny", "listContainsAll", "listEmpty"]);

export interface FilterCond { column: string; op: FilterOp; value: FrameCell; matchCase?: boolean }
export interface FilterCondConfig { op: FilterOp; matchCase?: boolean }
export type FilterCombine = "and" | "or";

export type FrameOp =
  | { kind: "select"; columns: string[] }
  | { kind: "drop"; columns: string[] }
  | { kind: "rename"; map: Record<string, string> }
  | { kind: "sort"; by: string; dir: "asc" | "desc" }
  | { kind: "distinct"; columns?: string[] }
  | { kind: "head"; n: number }
  | { kind: "filter"; column: string; op: FilterOp; value: FrameCell; matchCase?: boolean }
  | { kind: "filterMulti"; combine: FilterCombine; conditions: FilterCond[]; complement?: boolean }
  | { kind: "groupBy"; keys: string[]; aggs: AggSpec[] }
  | { kind: "unpivot"; idColumns: string[]; valueColumns: string[]; variableName?: string; valueName?: string }
  | ({ kind: "pivot" } & PivotSpec)
  | ({ kind: "window" } & WindowSpec)
  | { kind: "fillBlanks"; columns: string[]; dir: "down" | "up" }
  | { kind: "replaceValues"; column: string; find: string; replaceWith: string; mode: "cell" | "substring" }
  | { kind: "sliceRows"; mode: "first" | "last" | "skip" | "range"; n: number; to?: number };

export const FRAME_OP_KINDS = [
  "select", "drop", "rename", "sort", "distinct", "head",
  "filter", "filterMulti", "groupBy", "unpivot", "pivot", "window", "fillBlanks", "replaceValues", "sliceRows",
] as const satisfies readonly FrameOp["kind"][];
type _MissingFrameOpKind = Exclude<FrameOp["kind"], (typeof FRAME_OP_KINDS)[number]>;
const _frameOpKindsExhaustive: _MissingFrameOpKind[] = [] satisfies never[];
void _frameOpKindsExhaustive;

/** `readingScale` marks the column as readings on an offset scale (°C 1, °F 5/9); `unitScale` is a
 *  linear unit's scale (km 1000), which a variance needs to land in base SI. The oracle reads both
 *  off the column's unit when absent; the native engine, which sees no units, needs them. */
export interface AggSpec { column: string; op: AggOp; as: string; readingScale?: number; unitScale?: number }

const frame = (columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });

function requireColumn(f: FrameValue, name: string): FrameColumn {
  const col = f.columns.find((c) => c.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  return col;
}

const cellAt = (col: FrameColumn, i: number): FrameCell =>
  i < col.values.length ? col.values[i] : null;

export function reorderRows(f: FrameValue, indices: readonly number[]): FrameValue {
  return frame(f.columns.map((c) => ({ ...withoutRaw(c), values: indices.map((i) => cellAt(c, i)) })));
}

function withoutRaw(c: FrameColumn): Omit<FrameColumn, "raw"> {
  const { raw: _raw, ...rest } = c;
  return rest;
}

// Not `a - b`, which is NaN for two equal infinities and splits their tie.
const compareNumbers = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

function comparatorFor(type: FrameColType): (a: FrameCell, b: FrameCell) => number {
  switch (type) {
    case "string": return (a, b) => compareStrings(String(a), String(b));
    case "logical": return (a, b) => (a ? 1 : 0) - (b ? 1 : 0);
    default: return (a, b) => compareNumbers(a as number, b as number);
  }
}

function encodeCell(v: FrameCell): unknown {
  if (isSolError(v)) return ["e", v.code];
  if (v === null) return ["n"];
  if (typeof v === "boolean") return ["b", v];
  if (typeof v === "number") {
    if (Number.isFinite(v)) return ["#", v];
    return ["#", Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf"];
  }
  return ["s", v];
}

function sortedIndexOrder(len: number, cellAt: (i: number) => FrameCell, type: FrameColType, dir: "asc" | "desc"): number[] {
  const cmp = comparatorFor(type);
  const isTail = (i: number) => {
    const v = cellAt(i);
    return v === null || isSolError(v) || (typeof v === "number" && Number.isNaN(v));
  };
  const idx = Array.from({ length: len }, (_, i) => i);
  idx.sort((i, j) => {
    const ti = isTail(i), tj = isTail(j);
    if (ti || tj) return ti && tj ? i - j : ti ? 1 : -1;
    const c = cmp(cellAt(i), cellAt(j));
    return c !== 0 ? (dir === "desc" ? -c : c) : i - j;
  });
  return idx;
}

export function sortByColumn(f: FrameValue, by: string, dir: "asc" | "desc"): FrameValue {
  const col = requireColumn(f, by);
  return reorderRows(f, sortedIndexOrder(frameRowCount(f), (i) => cellAt(col, i), col.type, dir));
}

function distinctIndexOrder(len: number, keyAt: (i: number) => string): number[] {
  const seen = new Set<string>();
  const keep: number[] = [];
  for (let i = 0; i < len; i++) {
    const key = keyAt(i);
    if (!seen.has(key)) { seen.add(key); keep.push(i); }
  }
  return keep;
}

export function distinctRows(f: FrameValue, columns?: readonly string[]): FrameValue {
  const cols = (columns ?? f.columns.map((c) => c.name)).map((n) => requireColumn(f, n));
  return reorderRows(f, distinctIndexOrder(frameRowCount(f),
    (i) => JSON.stringify(cols.map((c) => encodeCell(cellAt(c, i))))));
}

export function distinctColumnValues(
  cells: readonly (string | null | undefined)[],
  isExcluded?: (v: string) => boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cells) {
    if (c == null || c === "") continue;
    if (isExcluded?.(c)) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function headRows(f: FrameValue, n: number): FrameValue {
  const take = Math.max(0, Math.min(Math.trunc(n), frameRowCount(f)));
  return reorderRows(f, Array.from({ length: take }, (_, i) => i));
}

export function sampleFrame(f: FrameValue, n: number): FrameValue {
  const total = frameRowCount(f);
  if (total <= n || n <= 0) return f;
  const stride = total / n;
  const idx = Array.from({ length: n }, (_, i) => Math.min(total - 1, Math.floor(i * stride)));
  return reorderRows(f, idx);
}

function filterValueToNumber(value: FrameCell, type: FrameColType): number | null {
  if (type === "logical") {
    const b = coerceLogical(value);
    return b === null ? null : b ? 1 : 0;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const n = decimalFromText(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const TEXT_FILTER_OPS: ReadonlySet<FilterOp> = new Set(["contains", "startsWith", "endsWith"]);

const TEXT_OP_LABEL: Record<string, string> = {
  contains: "Contains", startsWith: "Starts with", endsWith: "Ends with",
};

export function requireTextColumn(op: FilterOp, type: FrameColType, column: string): void {
  if (!TEXT_FILTER_OPS.has(op) || type === "string") return;
  throw solError(
    "#TYPE!",
    `${TEXT_OP_LABEL[op] ?? op} reads text — "${column}" is a ${type} column. ` +
    `Convert it first: a Computed Column like TEXT(@${column}, "@"), or Cast to Text`,
  );
}

export function requireTextList(op: FilterOp, type: FrameColType): void {
  if (!TEXT_FILTER_OPS.has(op) || type === "string") return;
  throw solError(
    "#TYPE!",
    `${TEXT_OP_LABEL[op] ?? op} reads text — this is a ${type} list. Cast it to Text first`,
  );
}

export function passesFilter(cell: FrameCell, op: FilterOp, value: FrameCell, type: FrameColType, matchCase: boolean): boolean {
  if (op === "listContains" || op === "listContainsAny" || op === "listContainsAll" || op === "listEmpty") return false;
  if (op === "iserror")  return isSolError(cell);
  if (op === "noterror") return !isSolError(cell);
  if (op === "isblank")  return cell === null;
  if (op === "notblank") return cell !== null;
  if (cell === null || isSolError(cell)) return false;
  if (value === null) return false;
  const fold = (s: string) => (matchCase ? s : s.toLowerCase());
  if (op === "contains")   return fold(String(cell)).includes(fold(String(value)));
  if (op === "startsWith") return fold(String(cell)).startsWith(fold(String(value)));
  if (op === "endsWith")   return fold(String(cell)).endsWith(fold(String(value)));
  if (type === "string") {
    if (op === "eq")  return fold(String(cell)) === fold(String(value));
    if (op === "neq") return fold(String(cell)) !== fold(String(value));
    return compareOp(op, compareStrings(String(cell), String(value)), 0);
  }
  const x = type === "logical" ? (cell ? 1 : 0) : Number(cell);
  const y = filterValueToNumber(value, type);
  if (y === null) return false;
  return compareOp(op, x, y);
}

export function filterRows(f: FrameValue, column: string, op: FilterOp, value: FrameCell, matchCase = false): FrameValue {
  const col = requireColumn(f, column);
  requireTextColumn(op, col.type, column);
  const keep: number[] = [];
  for (let i = 0; i < frameRowCount(f); i++) {
    if (passesFilter(cellAt(col, i), op, value, col.type, matchCase)) keep.push(i);
  }
  return reorderRows(f, keep);
}

export function filterRowsMulti(f: FrameValue, combine: FilterCombine, conditions: readonly FilterCond[], complement = false): FrameValue {
  if (conditions.length === 0) return complement ? reorderRows(f, []) : f;
  const cols = conditions.map((c) => requireColumn(f, c.column));
  for (let j = 0; j < conditions.length; j++) requireTextColumn(conditions[j].op, cols[j].type, conditions[j].column);
  const keep: number[] = [];
  for (let i = 0; i < frameRowCount(f); i++) {
    const pass = (c: FilterCond, j: number) =>
      passesFilter(cellAt(cols[j], i), c.op, c.value, cols[j].type, c.matchCase ?? false);
    const kept = combine === "and" ? conditions.every(pass) : conditions.some(pass);
    if (kept !== complement) keep.push(i);
  }
  return reorderRows(f, keep);
}

// ─── Cube row verbs ───────────────────────────────────────────────────────────

export function encodeCubeCell(v: CubeCell): unknown {
  if (Array.isArray(v)) return ["l", v.map(encodeCubeCell)];
  if (isCubeValue(v)) return ["c", v.columns.map((c) => [c.name, c.cells.map(encodeCubeCell)])];
  if (isFrameValue(v)) return ["f", v.columns.map((c) => [c.name, c.values.map(encodeCell)])];
  return encodeCell(v as FrameCell);
}

function cubeScalarColumn(cube: CubeValue, name: string): FrameColumn {
  const col = cube.columns.find((c) => c.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  for (const cell of col.cells) {
    if (Array.isArray(cell) || isFrameValue(cell) || isCubeValue(cell)) {
      throw solError("#SHAPE!", `"${name}" has list or table cells; this needs a scalar column`);
    }
  }
  return inferColumn(name, col.cells);
}

export function passesListFilter(cell: CubeCell, op: FilterOp, value: FrameCell, matchCase: boolean): boolean {
  const items = Array.isArray(cell) ? cell : cell === null ? [] : [cell];
  if (op === "listEmpty") return items.length === 0;
  const fold = (s: string) => (matchCase ? s : s.toLowerCase());
  const has = (needle: string) =>
    items.some((it) => !Array.isArray(it) && !isFrameValue(it) && !isCubeValue(it) && it !== null && fold(String(it)) === fold(needle));
  if (op === "listContains") return has(String(value ?? "").trim());
  const needles = String(value ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (op === "listContainsAny") return needles.some(has);
  if (op === "listContainsAll") return needles.every(has);
  return false;
}

export function sortCube(cube: CubeValue, by: string, dir: "asc" | "desc"): CubeValue {
  const col = cubeScalarColumn(cube, by);
  return selectCubeRows(cube, sortedIndexOrder(cubeRowCount(cube), (i) => cellAt(col, i), col.type, dir));
}

export function distinctCube(cube: CubeValue): CubeValue {
  return selectCubeRows(cube, distinctIndexOrder(cubeRowCount(cube),
    (i) => JSON.stringify(cube.columns.map((c) => encodeCubeCell(c.cells[i] ?? null)))));
}

export function sliceCube(cube: CubeValue, mode: "first" | "last" | "skip" | "range", n: number, to?: number): CubeValue {
  const [start, end] = sliceBounds(cubeRowCount(cube), mode, n, to);
  return selectCubeRows(cube, Array.from({ length: end - start }, (_, k) => start + k));
}

export function filterCube(cube: CubeValue, combine: FilterCombine, conditions: readonly FilterCond[], complement = false): CubeValue {
  if (conditions.length === 0) return complement ? selectCubeRows(cube, []) : cube;
  const resolved = conditions.map((c) => {
    if (LIST_FILTER_OPS.has(c.op)) {
      const raw = cube.columns.find((cc) => cc.name === c.column);
      if (!raw) throw solError("#REF!", `column "${c.column}" not found`);
      return { list: true as const, cells: raw.cells };
    }
    const col = cubeScalarColumn(cube, c.column);
    requireTextColumn(c.op, col.type, c.column);
    return { list: false as const, col };
  });
  const keep: number[] = [];
  for (let i = 0; i < cubeRowCount(cube); i++) {
    const passOne = (c: FilterCond, j: number) => {
      const r = resolved[j];
      return r.list
        ? passesListFilter(r.cells[i] ?? null, c.op, c.value, c.matchCase ?? false)
        : passesFilter(cellAt(r.col, i), c.op, c.value, r.col.type, c.matchCase ?? false);
    };
    const kept = combine === "and" ? conditions.every(passOne) : conditions.some(passOne);
    if (kept !== complement) keep.push(i);
  }
  return selectCubeRows(cube, keep);
}

function modeOf(nums: readonly number[]): number {
  const counts = new Map<number, number>();
  let best = nums[0], bestCount = 0;
  for (const v of nums) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) { bestCount = c; best = v; }
  }
  return best;
}

function varianceOf(nums: readonly number[], sample: boolean): number | null {
  const n = nums.length;
  if (sample && n < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const ss = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return ss / (sample ? n - 1 : n);
}

export function aggregateGroup(values: FrameCell[], op: AggOp, type?: FrameColType): FrameCell {
  if (op === "count") return values.filter((v) => v !== null).length;
  if (op === "percentof") return null;
  if (type === "string" && (op === "min" || op === "max")) return textExtreme(values, op);
  const prep = forAggregate(values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
  if (prep.error) return prep.error;
  const nums = prep.nums;
  if (nums.length === 0) return op === "sum" ? 0 : op === "product" ? 1 : null;
  if (nums.some((n) => Number.isNaN(n))) return guardFinite(NaN, nums);
  const r = rawAggregate(nums, op);
  if (r === undefined) throw solError("#NAME?", `Unknown aggregation "${op}"`);
  return guardAgg(r, nums);
}

// [[D76]] textMinMax: code-unit order ([[C59]] byteStringOrder), blanks and "" skipped.
function textExtreme(values: readonly FrameCell[], op: "min" | "max"): FrameCell {
  let best: string | null = null;
  for (const v of values) {
    if (isSolError(v)) return v;
    if (v === null) continue;
    const t = String(v);
    if (t === "") continue;
    if (best === null || (op === "min" ? compareStrings(t, best) < 0 : compareStrings(t, best) > 0)) best = t;
  }
  return best;
}

function guardAgg(r: number | null, inputs: readonly number[]): FrameCell {
  return typeof r === "number" ? guardFinite(r, inputs) : r;
}

function rawAggregate(nums: readonly number[], op: Exclude<AggOp, "count" | "percentof">): number | null {
  switch (op) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return nums.reduce((a, b) => (b < a ? b : a));
    case "max": return nums.reduce((a, b) => (b > a ? b : a));
    case "product": return nums.reduce((a, b) => a * b, 1);
    case "median": {
      const s = [...nums].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case "mode": return modeOf(nums);
    case "stdev":  { const v = varianceOf(nums, true);  return v === null ? null : Math.sqrt(v); }
    case "stdevp": { const v = varianceOf(nums, false); return v === null ? null : Math.sqrt(v); }
    case "var":    return varianceOf(nums, true);
    case "varp":   return varianceOf(nums, false);
  }
}

function sumGroup(values: FrameCell[]): FrameCell {
  const prep = forAggregate(values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
  if (prep.error) return prep.error;
  return prep.nums.filter((n) => Number.isFinite(n)).reduce((a, b) => a + b, 0);
}

const UNIT_KEEPING_AGGS: ReadonlySet<string> = new Set(["sum", "avg", "min", "max", "median", "mode", "first", "last"]);

// ─── Units through an aggregate ([[C25]] firstClassUnits) ───
// As in a formula: a spread keeps a linear unit and a variance squares it, in base SI as
// VAR's is. Readings on an offset scale (°C, °F) have no sum, product or share; a spread is
// a delta in kelvin (var a squared one); the averages and picks stay readings. A refused op
// is #UNIT! in every cell of its column, since the op, not a cell, is at fault.

/** The display scale of an offset unit (°C 1, °F 5/9), or undefined for any other unit. */
export function readingScaleOf(unit: ColumnUnit | undefined): number | undefined {
  const d = unit?.display;
  return d && isAffineDisplay(d) ? fcUnitToUnit(d)?.scale ?? 1 : undefined;
}

/** The display scale of a linear unit other than its base (km 1000), else undefined. */
export function linearScaleOf(unit: ColumnUnit | undefined): number | undefined {
  const d = unit?.display;
  if (!d || isAffineDisplay(d)) return undefined;
  const s = fcUnitToUnit(d)?.scale;
  return s === undefined || s === 1 ? undefined : s;
}

const AGG_READINGS_REFUSED: Partial<Record<AggOp, string>> = { sum: READINGS_ADD, product: READINGS_SCALE, percentof: READINGS_SCALE };
const AGG_READINGS_DELTA: Partial<Record<AggOp, 1 | 2>> = { stdev: 1, stdevp: 1, var: 2, varp: 2 };

interface ReadingPlan { cell: (v: FrameCell) => FrameCell; unit?: ColumnUnit }

const scaledBy = (k: number) => (v: FrameCell): FrameCell => (typeof v === "number" && Number.isFinite(v) ? v * k : v);

function readingPlan(
  unit: ColumnUnit | undefined, given: number | undefined, refused: string | undefined, delta: 1 | 2 | undefined, keeps: boolean,
  givenLinear?: number,
): ReadingPlan {
  const scale = given ?? readingScaleOf(unit);
  const kept = { cell: (v: FrameCell) => v, ...(unit && (keeps || delta === 1) ? { unit } : {}) };
  if (scale === undefined) {
    if (delta !== 2) return kept;
    const k = (givenLinear ?? linearScaleOf(unit) ?? 1) ** 2;
    return { cell: k === 1 ? kept.cell : scaledBy(k), ...(unit ? { unit: { dim: dimPow(unit.dim, 2) } } : {}) };
  }
  if (refused !== undefined) { const err = unitError(refused); return { cell: () => err }; }
  if (delta === undefined) return kept;
  return {
    cell: scaledBy(delta === 2 ? scale * scale : scale),
    unit: { dim: dimPow(unit?.dim ?? { temperature: 1 }, delta) },
  };
}

/** How an aggregate answers over a column: its cells and its unit. */
export function aggUnitPlan(op: AggOp, unit: ColumnUnit | undefined, readingScale?: number, unitScale?: number): ReadingPlan {
  return readingPlan(unit, readingScale, AGG_READINGS_REFUSED[op], AGG_READINGS_DELTA[op], UNIT_KEEPING_AGGS.has(op), unitScale);
}

export function groupByFrame(f: FrameValue, keys: readonly string[], aggs: readonly AggSpec[]): FrameValue {
  const keyCols = keys.map((n) => requireColumn(f, n));
  const aggCols = aggs.map((a) => ({ spec: a, col: requireColumn(f, a.column) }));
  const buckets = new Map<string, number[]>();
  const keyOrder: string[] = [];
  for (let i = 0; i < frameRowCount(f); i++) {
    const key = JSON.stringify(keyCols.map((c) => encodeCell(cellAt(c, i))));
    let rows = buckets.get(key);
    if (!rows) { rows = []; buckets.set(key, rows); keyOrder.push(key); }
    rows.push(i);
  }
  const keyOut: FrameColumn[] = keyCols.map((c) => ({
    name: c.name, type: c.type, ...(c.unit ? { unit: c.unit } : {}),
    values: keyOrder.map((k) => cellAt(c, buckets.get(k)![0])),
  }));
  const aggOut: FrameColumn[] = aggCols.map(({ spec, col }) => {
    const preserves = spec.op === "min" || spec.op === "max";
    const plan = aggUnitPlan(spec.op, col.unit, spec.readingScale, spec.unitScale);
    let values = keyOrder.map((k) => plan.cell(aggregateGroup(buckets.get(k)!.map((i) => cellAt(col, i)), spec.op, col.type)));
    if (preserves && col.type === "logical") {
      values = values.map((v) => (typeof v === "number" ? v !== 0 : v));
    }
    return {
      name: spec.as,
      type: preserves ? col.type : "number",
      ...(plan.unit ? { unit: plan.unit } : {}),
      values,
    };
  });
  const out = [...keyOut, ...aggOut];
  const unique = makeHeaders(out.map((c) => c.name), out.length);
  out.forEach((c, i) => { c.name = unique[i]; });
  return frame(out);
}

export function selectColumns(f: FrameValue, names: readonly string[]): FrameValue {
  const seen = new Set<string>();
  const wanted = names.filter((n) => !seen.has(n) && (seen.add(n), true));
  return frame(wanted.map((n) => requireColumn(f, n)));
}

export function dropColumns(f: FrameValue, names: readonly string[]): FrameValue {
  const remove = new Set(names);
  return frame(f.columns.filter((c) => !remove.has(c.name)));
}

export function renameColumns(f: FrameValue, map: Record<string, string>): FrameValue {
  const proposed = f.columns.map((c) => (map[c.name] ?? c.name));
  const unique = makeHeaders(proposed, proposed.length);
  return frame(f.columns.map((c, i) => ({ ...c, name: unique[i] })));
}

export function splitColumn(f: FrameValue, column: string, delimiter: string, names?: readonly string[]): FrameValue {
  const col = requireColumn(f, column);
  if (delimiter === "") return f;
  const idx = f.columns.indexOf(col);
  const parts: string[][] = col.values.map((v) => (v == null || isSolError(v) ? [] : String(v).split(delimiter)));
  const n = parts.reduce((m, p) => Math.max(m, p.length), 0);
  const newCols: FrameColumn[] = Array.from({ length: n }, (_, k) => ({
    name: names?.[k]?.trim() || `${column} ${k + 1}`,
    type: "string" as const,
    values: parts.map((p) => (k < p.length ? p[k] : null)),
  }));
  const out = [...f.columns.slice(0, idx), ...newCols, ...f.columns.slice(idx + 1)];
  const unique = makeHeaders(out.map((c) => c.name), out.length);
  return frame(out.map((c, i) => ({ ...c, name: unique[i] })));
}

export function addIndexColumn(f: FrameValue, name: string, start: number): FrameValue {
  const rows = frameRowCount(f);
  const nm = name.trim() || "Index";
  const unique = makeHeaders([nm, ...f.columns.map((c) => c.name)], 1 + f.columns.length);
  return frame([
    { name: unique[0], type: "number", values: Array.from({ length: rows }, (_, i) => start + i) },
    ...f.columns.map((c, i) => ({ ...c, name: unique[i + 1] })),
  ]);
}

// ─── Join (binary) ─────────────────────────────────────────────────────────────
export type JoinHow = "inner" | "left" | "right" | "outer" | "semi" | "anti" | "asof" | "cross";
export type AsofDirection = "backward" | "forward" | "nearest";
export interface JoinOpts {
  leftKey: string; rightKey: string; how: JoinHow;
  asofDirection?: AsofDirection;
  asofTolerance?: number;
  rightKeyScale?: number;
  rightKeyOffset?: number;
}

export function joinKeyTransform(left: FrameColumn | undefined, right: FrameColumn | undefined): { scale: number; offset: number } | null {
  const lu = left?.unit, ru = right?.unit;
  if (!lu || !ru || sameColumnUnit(lu, ru)) return null;
  const isCurrency = (d: typeof lu.dim) => dimEqual(d, { currency: 1 });
  if (!dimEqual(lu.dim, ru.dim) || (isCurrency(lu.dim) && (lu.display ?? "") !== (ru.display ?? ""))) {
    throw solError("#UNIT!", `Join keys measure different things (${lu.display ?? formatDim(lu.dim)} and ${ru.display ?? formatDim(ru.dim)}). Convert one key first`);
  }
  const affine = (u: ColumnUnit) => { const x = u.display ? fcUnitToUnit(u.display) : null; return { a: x?.scale ?? 1, b: x?.offset ?? 0 }; };
  const l = affine(lu), r = affine(ru);
  return { scale: r.a / l.a, offset: (r.b - l.b) / l.a };
}

/** A right key read in the left key's unit, rounded at the 15th significant digit of the larger term. */
function convertKey(v: number, scale: number, offset: number): number {
  return roundAtLargerTerm(v * scale + offset, Math.max(Math.abs(v * scale), Math.abs(offset)));
}

const encKey = (v: FrameCell): string => JSON.stringify(encodeCell(v));

const unmatchableKey = (cell: FrameCell): boolean =>
  cell === null || isSolError(cell) || (typeof cell === "number" && !Number.isFinite(cell));

function keyIndex(col: FrameColumn, n: number): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const cell = cellAt(col, i);
    if (unmatchableKey(cell)) continue;
    const k = encKey(cell);
    const bucket = idx.get(k);
    if (bucket) bucket.push(i); else idx.set(k, [i]);
  }
  return idx;
}

const meta = (c: FrameColumn) => ({ ...(c.unit ? { unit: c.unit } : {}), ...(c.format ? { format: c.format } : {}) });

function assembleJoinOutput(
  left: FrameValue, right: FrameValue, leftKey: string, rightKey: string,
  pairs: readonly [number | null, number | null][],
): FrameValue {
  const rk = requireColumn(right, rightKey);
  const rightNonKey = right.columns.filter((c) => c.name !== rightKey);
  const names = makeHeaders(
    [...left.columns.map((c) => c.name), ...rightNonKey.map((c) => c.name)],
    left.columns.length + rightNonKey.length,
  );
  const out: FrameColumn[] = [];
  left.columns.forEach((c, ci) => {
    const isKey = c.name === leftKey;
    out.push({
      name: names[ci], type: c.type, ...meta(c),
      values: pairs.map(([l, r]) =>
        isKey
          ? (l !== null ? cellAt(c, l) : r !== null ? cellAt(rk, r) : null)
          : (l !== null ? cellAt(c, l) : null)),
    });
  });
  rightNonKey.forEach((c, ri) => {
    out.push({
      name: names[left.columns.length + ri], type: c.type, ...meta(c),
      values: pairs.map(([, r]) => (r !== null ? cellAt(c, r) : null)),
    });
  });
  return frame(out);
}

function isOrderableKey(type: FrameColType): boolean {
  return type === "number" || type === "date";
}

function asofNearest(
  sortedRight: readonly { key: number; idx: number }[], key: number,
  direction: AsofDirection, tolerance: number | undefined,
): number | null {
  const n = sortedRight.length;
  if (n === 0) return null;
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedRight[mid].key <= key) lo = mid + 1; else hi = mid; }
  const backward = lo - 1;
  let lo2 = 0, hi2 = n;
  while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (sortedRight[mid].key < key) lo2 = mid + 1; else hi2 = mid; }
  const forward = lo2 < n ? lo2 : -1;

  let pick: number;
  if (direction === "backward") pick = backward;
  else if (direction === "forward") pick = forward;
  else if (backward === -1) pick = forward;
  else if (forward === -1) pick = backward;
  else {
    const db = key - sortedRight[backward].key, df = sortedRight[forward].key - key;
    pick = df < db ? forward : backward;
  }
  if (pick === -1) return null;
  if (tolerance !== undefined && Math.abs(sortedRight[pick].key - key) > tolerance) return null;
  return sortedRight[pick].idx;
}

function asofPairs(
  left: FrameValue, lk: FrameColumn, right: FrameValue, rk: FrameColumn, opts: JoinOpts,
): [number | null, number | null][] {
  if (!isOrderableKey(lk.type) || !isOrderableKey(rk.type)) {
    throw solError("#VALUE!", "As-of join requires a numeric or date key");
  }
  const rn = frameRowCount(right);
  const sortedRight: { key: number; idx: number }[] = [];
  for (let j = 0; j < rn; j++) {
    const cell = cellAt(rk, j);
    if (cell === null || isSolError(cell) || !Number.isFinite(Number(cell))) continue;
    sortedRight.push({ key: Number(cell), idx: j });
  }
  sortedRight.sort((a, b) => a.key - b.key || a.idx - b.idx);
  const direction = opts.asofDirection ?? "backward";

  const ln = frameRowCount(left);
  const pairs: [number | null, number | null][] = [];
  for (let i = 0; i < ln; i++) {
    const cell = cellAt(lk, i);
    if (cell === null || isSolError(cell) || !Number.isFinite(Number(cell))) { pairs.push([i, null]); continue; }
    pairs.push([i, asofNearest(sortedRight, Number(cell), direction, opts.asofTolerance)]);
  }
  return pairs;
}

export function crossJoinFrames(left: FrameValue, right: FrameValue): FrameValue {
  const ln = frameRowCount(left), rn = frameRowCount(right);
  const names = makeHeaders(
    [...left.columns.map((c) => c.name), ...right.columns.map((c) => c.name)],
    left.columns.length + right.columns.length,
  );
  const out: FrameColumn[] = [];
  left.columns.forEach((c, ci) => {
    const values: FrameCell[] = [];
    for (let i = 0; i < ln; i++) { const v = cellAt(c, i); for (let j = 0; j < rn; j++) values.push(v); }
    out.push({ name: names[ci], type: c.type, values });
  });
  right.columns.forEach((c, ri) => {
    const values: FrameCell[] = [];
    for (let i = 0; i < ln; i++) for (let j = 0; j < rn; j++) values.push(cellAt(c, j));
    out.push({ name: names[left.columns.length + ri], type: c.type, values });
  });
  return frame(out);
}

export function joinFrames(left: FrameValue, right: FrameValue, opts: JoinOpts): FrameValue {
  if (!(["inner", "left", "right", "outer", "cross", "semi", "anti", "asof"] as string[]).includes(opts.how)) {
    throw solError("#VALUE!", `unknown join how "${opts.how}"`);
  }
  if (opts.how === "cross") return crossJoinFrames(left, right);
  const lk = requireColumn(left, opts.leftKey);
  let rk = requireColumn(right, opts.rightKey);
  if (lk.type !== rk.type) {
    throw solError("#TYPE!", `Join keys must share a type ("${lk.type}" vs "${rk.type}")`);
  }
  const t = opts.rightKeyScale !== undefined || opts.rightKeyOffset !== undefined
    ? { scale: opts.rightKeyScale ?? 1, offset: opts.rightKeyOffset ?? 0 }
    : joinKeyTransform(lk, rk);
  if (t && (t.scale !== 1 || t.offset !== 0) && rk.type === "number") {
    const scaled: FrameColumn = {
      ...rk, ...(lk.unit ? { unit: lk.unit } : {}),
      values: rk.values.map((v) => (typeof v === "number" ? convertKey(v, t.scale, t.offset) : v)),
    };
    const { raw: _raw, ...clean } = scaled;
    right = frame(right.columns.map((c) => (c === rk ? clean : c)));
    rk = clean;
  }
  const ln = frameRowCount(left), rn = frameRowCount(right);

  if (opts.how === "semi" || opts.how === "anti") {
    const rIdx = keyIndex(rk, rn);
    const keep: number[] = [];
    for (let i = 0; i < ln; i++) {
      const cell = cellAt(lk, i);
      const matched = cell !== null && !isSolError(cell) && rIdx.has(encKey(cell));
      if (matched === (opts.how === "semi")) keep.push(i);
    }
    return frame(left.columns.map((c) => ({
      name: c.name, type: c.type, values: keep.map((i) => cellAt(c, i)),
    })));
  }

  let pairs: [number | null, number | null][];
  if (opts.how === "asof") {
    pairs = asofPairs(left, lk, right, rk, opts);
  } else if (opts.how === "right") {
    pairs = [];
    const lIdx = keyIndex(lk, ln);
    for (let j = 0; j < rn; j++) {
      const ms = lIdx.get(encKey(cellAt(rk, j))) ?? [];
      if (ms.length) for (const i of ms) pairs.push([i, j]);
      else pairs.push([null, j]);
    }
  } else {
    pairs = [];
    const rIdx = keyIndex(rk, rn);
    const matchedRight = new Set<number>();
    for (let i = 0; i < ln; i++) {
      const ms = rIdx.get(encKey(cellAt(lk, i))) ?? [];
      if (ms.length) for (const j of ms) { pairs.push([i, j]); matchedRight.add(j); }
      else if (opts.how === "left" || opts.how === "outer") pairs.push([i, null]);
    }
    if (opts.how === "outer") {
      for (let j = 0; j < rn; j++) if (!matchedRight.has(j)) pairs.push([null, j]);
    }
  }

  return assembleJoinOutput(left, right, opts.leftKey, opts.rightKey, pairs);
}


// ─── Reconcile ─────────────────────────────────────────────────────────────────
export type ReconcileStatus = "added" | "removed" | "changed" | "unchanged" | "skipped";
export interface ReconcileOpts {
  leftKey: string;
  rightKey: string;
  priceColumn?: string;
  qtyColumn?: string;
}
export interface PvmBreakdown {
  totalBefore: number;
  totalAfter: number;
  delta: number;
  price: number;
  volume: number;
  mix: number;
  excluded: number;
}
export interface ReconcileSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  skipped: number;
  addedColumns: string[];
  removedColumns: string[];
  pvm?: PvmBreakdown;
}

function cellsEqual(a: FrameCell, b: FrameCell): boolean {
  if (a === null && b === null) return true;
  if (isSolError(a) || isSolError(b)) return false;
  return a === b;
}

export function reconcileFrames(
  left: FrameValue, right: FrameValue, opts: ReconcileOpts,
): { frame: FrameValue; summary: ReconcileSummary } {
  const lk = requireColumn(left, opts.leftKey);
  const rk = requireColumn(right, opts.rightKey);
  const ln = frameRowCount(left), rn = frameRowCount(right);

  const lIdx = keyIndex(lk, ln);
  const rIdx = keyIndex(rk, rn);
  const allKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (const k of lIdx.keys()) if (!seenKeys.has(k)) { seenKeys.add(k); allKeys.push(k); }
  for (const k of rIdx.keys()) if (!seenKeys.has(k)) { seenKeys.add(k); allKeys.push(k); }

  const sharedCols = left.columns
    .filter((c) => c.name !== opts.leftKey)
    .map((c) => ({ name: c.name, left: c, right: right.columns.find((rc) => rc.name === c.name) ?? null }))
    .filter((s): s is { name: string; left: FrameColumn; right: FrameColumn } => s.right !== null);

  const rightNames = new Set(right.columns.map((c) => c.name));
  const leftNames = new Set(left.columns.map((c) => c.name));
  const removedCols = left.columns.filter((c) => c.name !== opts.leftKey && !rightNames.has(c.name));
  const addedCols = right.columns.filter((c) => c.name !== opts.rightKey && !leftNames.has(c.name));

  let priceIdx = -1, qtyIdx = -1;
  sharedCols.forEach((s, i) => {
    if (opts.priceColumn && s.name === opts.priceColumn && s.left.type === "number" && s.right.type === "number") priceIdx = i;
    if (opts.qtyColumn && s.name === opts.qtyColumn && s.left.type === "number" && s.right.type === "number") qtyIdx = i;
  });
  const havePvm = priceIdx >= 0 && qtyIdx >= 0;

  const keyValues: FrameCell[] = [];
  const statuses: FrameCell[] = [];
  const beforeCols: FrameCell[][] = sharedCols.map(() => []);
  const afterCols: FrameCell[][] = sharedCols.map(() => []);
  const deltaCols: (number | null)[][] = sharedCols.map(() => []);
  const removedColVals: FrameCell[][] = removedCols.map(() => []);
  const addedColVals: FrameCell[][] = addedCols.map(() => []);

  const pushRow = (keyCell: FrameCell, status: ReconcileStatus, li: number | null, ri: number | null) => {
    keyValues.push(keyCell);
    statuses.push(status);
    sharedCols.forEach((s, ci) => {
      const bv = li !== null ? cellAt(s.left, li) : null;
      const av = ri !== null ? cellAt(s.right, ri) : null;
      beforeCols[ci].push(bv);
      afterCols[ci].push(av);
      const bn = typeof bv === "number" ? bv : null;
      const an = typeof av === "number" ? av : null;
      deltaCols[ci].push(s.left.type === "number" && bn !== null && an !== null ? an - bn : null);
    });
    removedCols.forEach((c, ci) => removedColVals[ci].push(li !== null ? cellAt(c, li) : null));
    addedCols.forEach((c, ci) => addedColVals[ci].push(ri !== null ? cellAt(c, ri) : null));
  };

  const pvmFactor = (present: boolean, raw: FrameCell): number | null =>
    !present ? 0 : (typeof raw === "number" ? raw : null);

  let added = 0, removed = 0, changed = 0, unchanged = 0, skipped = 0;
  let totalBefore = 0, totalAfter = 0, pvmPrice = 0, pvmVolume = 0, pvmMix = 0, pvmExcluded = 0;

  for (const k of allKeys) {
    const lRows = lIdx.get(k) ?? [];
    const rRows = rIdx.get(k) ?? [];
    const pairs = Math.max(lRows.length, rRows.length);
    for (let p = 0; p < pairs; p++) {
      const li = lRows[p] ?? null;
      const ri = rRows[p] ?? null;

      let status: ReconcileStatus;
      if (li === null) { status = "added"; added++; }
      else if (ri === null) { status = "removed"; removed++; }
      else {
        const rowChanged = sharedCols.some((s) => !cellsEqual(cellAt(s.left, li), cellAt(s.right, ri)));
        status = rowChanged ? "changed" : "unchanged";
        if (rowChanged) changed++; else unchanged++;
      }
      pushRow(li !== null ? cellAt(lk, li) : cellAt(rk, ri), status, li, ri);

      if (havePvm) {
        const p0 = pvmFactor(li !== null, li !== null ? cellAt(sharedCols[priceIdx].left, li) : null);
        const p1 = pvmFactor(ri !== null, ri !== null ? cellAt(sharedCols[priceIdx].right, ri) : null);
        const q0 = pvmFactor(li !== null, li !== null ? cellAt(sharedCols[qtyIdx].left, li) : null);
        const q1 = pvmFactor(ri !== null, ri !== null ? cellAt(sharedCols[qtyIdx].right, ri) : null);
        if (p0 === null || p1 === null || q0 === null || q1 === null) {
          pvmExcluded++;
        } else {
          totalBefore += p0 * q0;
          totalAfter += p1 * q1;
          pvmPrice += (p1 - p0) * q0;
          pvmVolume += (q1 - q0) * p0;
          pvmMix += (p1 - p0) * (q1 - q0);
        }
      }
    }
  }

  for (let i = 0; i < ln; i++) {
    const kc = cellAt(lk, i);
    if (unmatchableKey(kc)) { pushRow(kc, "skipped", i, null); skipped++; }
  }
  for (let i = 0; i < rn; i++) {
    const kc = cellAt(rk, i);
    if (unmatchableKey(kc)) { pushRow(kc, "skipped", null, i); skipped++; }
  }

  const outCols: FrameColumn[] = [
    { name: opts.leftKey, type: lk.type, values: keyValues },
    { name: "Status", type: "string", values: statuses },
  ];
  sharedCols.forEach((s, ci) => {
    outCols.push({ name: `${s.name} (before)`, type: s.left.type, values: beforeCols[ci] });
    outCols.push({ name: `${s.name} (after)`, type: s.right.type, values: afterCols[ci] });
    if (s.left.type === "number") outCols.push({ name: `${s.name} Δ`, type: "number", values: deltaCols[ci] });
  });
  removedCols.forEach((c, ci) => outCols.push({ name: `${c.name} (removed)`, type: c.type, values: removedColVals[ci] }));
  addedCols.forEach((c, ci) => outCols.push({ name: `${c.name} (added)`, type: c.type, values: addedColVals[ci] }));
  const names = makeHeaders(outCols.map((c) => c.name), outCols.length);
  const finalCols = outCols.map((c, i) => ({ ...c, name: names[i] }));

  const summary: ReconcileSummary = {
    added, removed, changed, unchanged, skipped,
    addedColumns: addedCols.map((c) => c.name),
    removedColumns: removedCols.map((c) => c.name),
  };
  if (havePvm) {
    summary.pvm = { totalBefore, totalAfter, delta: totalAfter - totalBefore, price: pvmPrice, volume: pvmVolume, mix: pvmMix, excluded: pvmExcluded };
  }
  return { frame: frame(finalCols), summary };
}

// ─── Reshape: pivot / unpivot ──────────────────────────────────────────────────
export function unpivotFrame(
  f: FrameValue, idColumns: readonly string[], valueColumns: readonly string[],
  opts?: { variableName?: string; valueName?: string },
): FrameValue {
  const idCols = idColumns.map((n) => requireColumn(f, n));
  const valCols = valueColumns.map((n) => requireColumn(f, n));
  const mixed = valCols.find((c) => c.type !== valCols[0].type);
  if (mixed) {
    throw solError("#TYPE!", `Unpivot value columns must share a type ("${valCols[0].name}" is ${valCols[0].type}, "${mixed.name}" is ${mixed.type})`);
  }
  const idVals: FrameCell[][] = idCols.map(() => []);
  const varVals: FrameCell[] = [];
  const valVals: FrameCell[] = [];
  for (let i = 0; i < frameRowCount(f); i++) {
    for (const vc of valCols) {
      idCols.forEach((c, k) => idVals[k].push(cellAt(c, i)));
      varVals.push(vc.name);
      valVals.push(cellAt(vc, i));
    }
  }
  const names = makeHeaders(
    [...idCols.map((c) => c.name), opts?.variableName ?? "variable", opts?.valueName ?? "value"],
    idCols.length + 2,
  );
  const sharedUnit = valCols.length > 0 && valCols.every((c) => sameColumnUnit(c.unit, valCols[0].unit)) ? valCols[0].unit : undefined;
  return frame([
    ...idCols.map((c, k) => ({ name: names[k], type: c.type, ...(c.unit ? { unit: c.unit } : {}), values: idVals[k] })),
    { name: names[idCols.length], type: "string" as const, values: varVals },
    { name: names[idCols.length + 1], type: valCols[0]?.type ?? "number", ...(sharedUnit ? { unit: sharedUnit } : {}), values: valVals },
  ]);
}

export interface PivotSpec {
  rowFields: readonly string[];
  colFields: readonly string[];
  values: readonly string[];
  funcs: readonly AggOp[];
  rowTotalDepth?: number;
  colTotalDepth?: number;
  rowSort?: number;
  colSort?: number;
  relativeTo?: number;
  filter?: ReadonlyArray<boolean | null>;
}

const tupleKey = (t: readonly FrameCell[]): string => JSON.stringify(t.map(encodeCell));
const leafKeyOf = (cols: readonly FrameColumn[], i: number): string =>
  JSON.stringify(cols.map((c) => encodeCell(cellAt(c, i))));

function orderLeaves(rows: readonly number[], cols: readonly FrameColumn[], sortField: number, desc: boolean): FrameCell[][] {
  if (cols.length === 0) return [[]];
  const tuples = new Map<string, FrameCell[]>();
  const firstSeen: string[] = [];
  for (const i of rows) {
    const k = leafKeyOf(cols, i);
    if (!tuples.has(k)) { tuples.set(k, cols.map((c) => cellAt(c, i))); firstSeen.push(k); }
  }
  const levelRank = cols.map(() => new Map<string, number>());
  const cellByEnc = cols.map(() => new Map<string, FrameCell>());
  for (const k of firstSeen) {
    tuples.get(k)!.forEach((cell, lvl) => {
      const vk = JSON.stringify(encodeCell(cell));
      if (!levelRank[lvl].has(vk)) { levelRank[lvl].set(vk, levelRank[lvl].size); cellByEnc[lvl].set(vk, cell); }
    });
  }
  let sortedRank: Map<string, number> | null = null;
  if (sortField >= 0 && sortField < cols.length) {
    const cmp = comparatorFor(cols[sortField].type);
    const isTail = (c: FrameCell) => c === null || isSolError(c);
    const ordered = [...cellByEnc[sortField].entries()]
      .sort(([, a], [, b]) => (isTail(a) || isTail(b) ? (isTail(a) && isTail(b) ? 0 : isTail(a) ? 1 : -1) : cmp(a, b)))
      .map(([vk]) => vk);
    if (desc) ordered.reverse();
    sortedRank = new Map(ordered.map((vk, idx) => [vk, idx]));
  }
  const rankAt = (lvl: number, vk: string) => (lvl === sortField && sortedRank ? sortedRank.get(vk)! : levelRank[lvl].get(vk)!);
  return firstSeen.map((k) => tuples.get(k)!).sort((a, b) => {
    for (let lvl = 0; lvl < cols.length; lvl++) {
      const ra = rankAt(lvl, JSON.stringify(encodeCell(a[lvl]))), rb = rankAt(lvl, JSON.stringify(encodeCell(b[lvl])));
      if (ra !== rb) return ra - rb;
    }
    return 0;
  });
}

interface AxisOut { kind: "leaf" | "sub" | "grand"; span: number[]; tuple: FrameCell[]; fill: number; }

function expandAxis(leaves: FrameCell[][], depth: number, nFields: number): AxisOut[] {
  const out: AxisOut[] = leaves.map((t, i) => ({ kind: "leaf" as const, span: [i], tuple: t, fill: nFields }));
  if (depth === 0 || nFields === 0) return out;
  const top = depth < 0;
  const subLevels = Math.min(Math.abs(depth) - 1, Math.max(0, nFields - 1));
  const subs: AxisOut[] = [];
  for (let p = 1; p <= subLevels; p++) {
    let start = 0;
    const prefixAt = (i: number) => tupleKey(leaves[i].slice(0, p));
    for (let i = 1; i <= leaves.length; i++) {
      if (i === leaves.length || prefixAt(i) !== prefixAt(start)) {
        const span = Array.from({ length: i - start }, (_, k) => start + k);
        subs.push({ kind: "sub", span, tuple: leaves[start].slice(0, p), fill: p });
        start = i;
      }
    }
  }
  const withSubs: AxisOut[] = [];
  const subsAt = new Map<string, AxisOut[]>();
  for (const s of subs) {
    const anchor = top ? s.span[0] : s.span[s.span.length - 1];
    const key = `${anchor}:${s.fill}`;
    (subsAt.get(key) ?? subsAt.set(key, []).get(key)!).push(s);
  }
  for (let i = 0; i < leaves.length; i++) {
    const here: AxisOut[] = [];
    if (top) for (let p = 1; p <= subLevels; p++) { const k = `${i}:${p}`; if (subsAt.has(k)) here.push(...subsAt.get(k)!); }
    else     for (let p = subLevels; p >= 1; p--) { const k = `${i}:${p}`; if (subsAt.has(k)) here.push(...subsAt.get(k)!); }
    if (top) withSubs.push(...here, out[i]); else withSubs.push(out[i], ...here);
  }
  const grand: AxisOut = { kind: "grand", span: out.map((_, i) => i), tuple: [], fill: 0 };
  return top ? [grand, ...withSubs] : [...withSubs, grand];
}

export function pivotFrame(f: FrameValue, spec: PivotSpec): FrameValue {
  const rowFields = spec.rowFields.filter((s) => s.trim() !== "");
  const colFields = spec.colFields.filter((s) => s.trim() !== "");
  const valueNames = spec.values.filter((s) => s.trim() !== "");
  if (valueNames.length === 0) throw solError("#VALUE!", "PIVOTBY needs at least one value field");
  const rowCols = rowFields.map((n) => requireColumn(f, n));
  const colCols = colFields.map((n) => requireColumn(f, n));
  const valCols = valueNames.map((n) => requireColumn(f, n));
  const funcs: AggOp[] = valueNames.map((_, i) => spec.funcs[i] ?? spec.funcs[0] ?? "sum");
  const relativeTo = spec.relativeTo ?? 0;

  const rows: number[] = [];
  for (let i = 0; i < frameRowCount(f); i++) if (!spec.filter || spec.filter[i] === true) rows.push(i);

  const rs = spec.rowSort ?? 0, cs = spec.colSort ?? 0;
  let rowLeaves = orderLeaves(rows, rowCols, Math.abs(rs) - 1 < rowCols.length ? Math.abs(rs) - 1 : -1, rs < 0);
  let colLeaves = orderLeaves(rows, colCols, Math.abs(cs) - 1 < colCols.length ? Math.abs(cs) - 1 : -1, cs < 0);
  const R = rowLeaves.length, C = colLeaves.length, V = valCols.length;
  const rowKeyIndex = new Map(rowLeaves.map((t, i) => [tupleKey(t), i]));
  const colKeyIndex = new Map(colLeaves.map((t, i) => [tupleKey(t), i]));

  const cells: FrameCell[][][][] = valCols.map(() =>
    Array.from({ length: R }, () => Array.from({ length: C }, () => [] as FrameCell[])));
  for (const i of rows) {
    const r = rowKeyIndex.get(leafKeyOf(rowCols, i)), c = colKeyIndex.get(leafKeyOf(colCols, i));
    if (r === undefined || c === undefined) continue;
    valCols.forEach((vc, v) => cells[v][r][c].push(cellAt(vc, i)));
  }

  const sortKey = (cellsList: FrameCell[], v: number): number | string | null => {
    const a = aggregateGroup(cellsList, funcs[v] === "percentof" ? "sum" : funcs[v], valCols[v].type);
    return (typeof a === "number" && !Number.isNaN(a)) || typeof a === "string" ? a : null;
  };
  const byKey = (desc: boolean) => (sx: number | string | null, sy: number | string | null): number => {
    if (sx === null || sy === null) return sx === null ? (sy === null ? 0 : 1) : -1;
    const d = typeof sx === "string" || typeof sy === "string" ? compareStrings(String(sx), String(sy)) : sx - sy;
    return desc ? -d : d;
  };
  const rowValSort = Math.abs(rs) - 1 - rowCols.length;
  if (rowValSort >= 0 && rowValSort < V && R > 1) {
    const score = (r: number) => sortKey(Array.from({ length: C }, (_, c) => cells[rowValSort][r][c]).flat(), rowValSort);
    const cmp = byKey(rs < 0);
    const perm = rowLeaves.map((_, r) => r).sort((x, y) => cmp(score(x), score(y)));
    rowLeaves = perm.map((r) => rowLeaves[r]);
    for (let v = 0; v < V; v++) cells[v] = perm.map((r) => cells[v][r]);
  }
  const colValSort = Math.abs(cs) - 1 - colCols.length;
  if (colValSort >= 0 && colValSort < V && C > 1) {
    const score = (c: number) => sortKey(Array.from({ length: R }, (_, r) => cells[colValSort][r][c]).flat(), colValSort);
    const cmp = byKey(cs < 0);
    const perm = colLeaves.map((_, c) => c).sort((x, y) => cmp(score(x), score(y)));
    colLeaves = perm.map((c) => colLeaves[c]);
    for (let v = 0; v < V; v++) for (let r = 0; r < R; r++) cells[v][r] = perm.map((c) => cells[v][r][c]);
  }
  const collect = (v: number, rset: readonly number[], cset: readonly number[]): FrameCell[] => {
    const acc: FrameCell[] = [];
    for (const r of rset) for (const c of cset) acc.push(...cells[v][r][c]);
    return acc;
  };
  const allRows = rowLeaves.map((_, i) => i), allCols = colLeaves.map((_, i) => i);
  const parentOf = (leaves: FrameCell[][], idx: number): number[] => {
    const t = leaves[idx]; if (t.length <= 1) return leaves.map((_, i) => i);
    const pk = tupleKey(t.slice(0, t.length - 1));
    return leaves.map((lt, i) => (tupleKey(lt.slice(0, lt.length - 1)) === pk ? i : -1)).filter((i) => i >= 0);
  };

  const cellValue = (v: number, rset: number[], cset: number[]): FrameCell => {
    const here = collect(v, rset, cset);
    if (here.length === 0) return null;
    if (funcs[v] !== "percentof") return aggregateGroup(here, funcs[v], valCols[v].type);
    const num = sumGroup(here);
    if (isSolError(num)) return num;
    let dr = rset, dc = cset;
    if (relativeTo === 0) dr = allRows;
    else if (relativeTo === 1) dc = allCols;
    else if (relativeTo === 2) { dr = allRows; dc = allCols; }
    else if (relativeTo === 3) dc = cset.length === 1 ? parentOf(colLeaves, cset[0]) : allCols;
    else if (relativeTo === 4) dr = rset.length === 1 ? parentOf(rowLeaves, rset[0]) : allRows;
    const den = sumGroup(collect(v, dr, dc));
    if (isSolError(den)) return den;
    return (den as number) === 0 ? null : (num as number) / (den as number);
  };

  const rowOut = expandAxis(rowLeaves, spec.rowTotalDepth ?? 0, rowCols.length);
  const colOut = expandAxis(colLeaves, spec.colTotalDepth ?? 0, colCols.length);

  const keyNames = makeHeaders(rowFields, rowFields.length);
  const hasTotals = rowOut.some((ro) => ro.kind !== "leaf");
  const keyColumns: FrameColumn[] = rowCols.map((c, k) => {
    const marked = hasTotals && rowOut.some((ro) => (ro.kind === "grand" && k === 0) || (ro.kind === "sub" && k === ro.fill));
    const values = rowOut.map((ro) => {
      if (ro.kind === "grand") return k === 0 ? "Grand Total" : null;
      if (ro.kind === "sub")   return k < ro.fill ? ro.tuple[k] : k === ro.fill ? "Total" : null;
      return ro.tuple[k];
    });
    return marked && c.type !== "string"
      ? { name: keyNames[k], type: "string" as const, values: values.map((v) => (v == null ? null : String(formatFrameCell(c.type, v as FrameCell) ?? v))) }
      : { name: keyNames[k], type: c.type, values };
  });

  const multiVal = V > 1;
  const colHeader = (co: AxisOut, v: number): string => {
    const base = co.kind === "grand" ? "Grand Total"
      : co.kind === "sub" ? [...co.tuple.map((x) => String(x)), "Total"].join(" | ")
      : co.tuple.map((x) => String(x)).join(" | ");
    if (multiVal) return base ? `${base} | ${valueNames[v]}` : valueNames[v];
    return base || valueNames[v];
  };
  const rawHeaders: string[] = [];
  const bodySpecs: { co: AxisOut; v: number }[] = [];
  for (const co of colOut) for (let v = 0; v < V; v++) { rawHeaders.push(colHeader(co, v)); bodySpecs.push({ co, v }); }
  const bodyNames = makeHeaders(rawHeaders, rawHeaders.length);
  const plans = valCols.map((c, v) => aggUnitPlan(funcs[v], c.unit));
  const bodyColumns: FrameColumn[] = bodySpecs.map(({ co, v }, bi) => ({
    name: bodyNames[bi], type: valCols[v].type === "string" && (funcs[v] === "min" || funcs[v] === "max") ? "string" : "number",
    ...(plans[v].unit ? { unit: plans[v].unit } : {}),
    values: rowOut.map((ro) => plans[v].cell(cellValue(v, ro.span, co.span))),
  }));

  return frame([...keyColumns, ...bodyColumns]);
}

// ─── Nest / Unnest (the flat ⟷ cube bridge) ───────────────────────────────────
const cubeCellAt = (col: CubeColumn, i: number): CubeCell => (i < col.cells.length ? col.cells[i] : null);

export function nestFrame(f: FrameValue, keyColumns: readonly string[], nestedName = "items"): CubeValue {
  const keyCols = keyColumns.map((n) => requireColumn(f, n));
  const keySet = new Set(keyColumns);
  const childCols = f.columns.filter((c) => !keySet.has(c.name));
  const buckets = new Map<string, number[]>();
  const order: string[] = [];
  for (let i = 0; i < frameRowCount(f); i++) {
    const key = JSON.stringify(keyCols.map((c) => encodeCell(cellAt(c, i))));
    const rows = buckets.get(key);
    if (rows) rows.push(i); else { buckets.set(key, [i]); order.push(key); }
  }
  const names = makeHeaders([...keyColumns, nestedName.trim() || "items"], keyColumns.length + 1);
  const keyOut: CubeColumn[] = keyCols.map((c, k) => ({
    name: names[k], type: c.type, cells: order.map((key) => cellAt(c, buckets.get(key)![0])),
  }));
  const nestedCells: CubeCell[] = order.map((key) => {
    const rowIdx = buckets.get(key)!;
    return {
      __frame: true,
      columns: childCols.map((c) => ({
        name: c.name, type: c.type, ...(c.unit ? { unit: c.unit } : {}), ...(c.format ? { format: c.format } : {}),
        values: rowIdx.map((i) => cellAt(c, i)),
      })),
    };
  });
  return cubeFromColumns([...keyOut, { name: names[keyColumns.length], cells: nestedCells }]);
}

export function unnestCube(c: CubeValue, nestedColumn: string): FrameValue | CubeValue {
  const nestedIdx = c.columns.findIndex((col) => col.name === nestedColumn);
  if (nestedIdx < 0) throw solError("#REF!", `column "${nestedColumn}" not found`);
  const flatCols = c.columns.filter((_, j) => j !== nestedIdx);
  const nested = c.columns[nestedIdx];

  let sawList = false, sawFrame = false, sawCube = false;
  for (const cell of nested.cells) {
    if (Array.isArray(cell)) sawList ||= cell.length > 0;
    else if (isFrameValue(cell)) sawFrame = true;
    else if (isCubeValue(cell)) sawCube = true;
  }
  if ([sawList, sawFrame, sawCube].filter(Boolean).length > 1) {
    throw solError("#TYPE!", "nested cells must all be lists, all tables, or all cubes");
  }
  if (!sawList && !sawFrame && !sawCube) sawList = nested.cells.some(Array.isArray);

  if (sawList) {
    const flatValsL: CubeCell[][] = flatCols.map(() => []);
    const explodedL: CubeCell[] = [];
    for (let i = 0; i < cubeRowCount(c); i++) {
      const cell = nested.cells[i];
      const items = Array.isArray(cell) ? cell : [];
      const pushParent = () => flatCols.forEach((fc, k) => flatValsL[k].push(cubeCellAt(fc, i)));
      if (items.length === 0) { pushParent(); explodedL.push(null); }
      else for (const item of items) { pushParent(); explodedL.push(item ?? null); }
    }
    return frame([
      ...flatCols.map((fc, k) => ({ ...inferColumn(fc.name, flatValsL[k]), name: fc.name })),
      { ...inferColumn(nested.name, explodedL), name: nested.name },
    ]);
  }

  if (sawCube) {
    const schemaCube = nested.cells.find((cell) => isCubeValue(cell));
    const childCubeCols = schemaCube?.columns ?? [];
    const flatValsC: CubeCell[][] = flatCols.map(() => []);
    const childValsC: CubeCell[][] = childCubeCols.map(() => []);
    for (let i = 0; i < cubeRowCount(c); i++) {
      const cell = nested.cells[i];
      const childCube = isCubeValue(cell) ? cell : null;
      const childRows = childCube ? cubeRowCount(childCube) : 0;
      for (let r = 0; r < childRows; r++) {
        flatCols.forEach((fc, k) => flatValsC[k].push(cubeCellAt(fc, i)));
        childCubeCols.forEach((cc, k) => {
          const col = childCube!.columns.find((x) => x.name === cc.name);
          childValsC[k].push(col ? (col.cells[r] ?? null) : null);
        });
      }
    }
    const namesC = makeHeaders(
      [...flatCols.map((c2) => c2.name), ...childCubeCols.map((c2) => c2.name)],
      flatCols.length + childCubeCols.length,
    );
    return cubeFromColumns([
      ...flatCols.map((fc, k) => ({ name: namesC[k], cells: flatValsC[k], ...(fc.type ? { type: fc.type } : {}) })),
      ...childCubeCols.map((cc, k) => ({ name: namesC[flatCols.length + k], cells: childValsC[k], ...(cc.type ? { type: cc.type } : {}) })),
    ]);
  }

  const schemaFrame = nested.cells.find((cell) => isFrameValue(cell));
  const childCols = schemaFrame?.columns ?? [];
  const flatVals: CubeCell[][] = flatCols.map(() => []);
  const childVals: FrameCell[][] = childCols.map(() => []);
  for (let i = 0; i < cubeRowCount(c); i++) {
    const cell = nested.cells[i];
    const childFrame = isFrameValue(cell) ? cell : null;
    const childRows = childFrame ? frameRowCount(childFrame) : 0;
    for (let r = 0; r < childRows; r++) {
      flatCols.forEach((fc, k) => flatVals[k].push(cubeCellAt(fc, i)));
      childCols.forEach((cc, k) => {
        const col = childFrame!.columns.find((x) => x.name === cc.name);
        childVals[k].push(col ? (col.values[r] ?? null) : null);
      });
    }
  }
  const names = makeHeaders(
    [...flatCols.map((c2) => c2.name), ...childCols.map((c2) => c2.name)],
    flatCols.length + childCols.length,
  );
  return frame([
    ...flatCols.map((_, k) => ({ ...inferColumn(names[k], flatVals[k]), name: names[k] })),
    ...childCols.map((cc, k) => ({ name: names[flatCols.length + k], type: cc.type, values: childVals[k] })),
  ]);
}

// ─── Frame lookup (XLOOKUP / VLOOKUP over a table) ──────────────────────────────
function lookupNeedle(lookup: string, type: FrameColType): FrameCell {
  if (type === "logical") return !!coerceLogical(lookup);
  if (type === "date") {
    const t = lookup.trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : parseDateToSerial(t);
  }
  if (type === "number") return decimalFromText(lookup);
  return lookup;
}

const NODE_TO_XMATCH_MODE: Record<LookupMatchMode, XMatchMatchMode> = {
  exact: "exact", nextSmaller: "next_smaller", nextLarger: "next_larger",
};

export type LookupMatchMode = "exact" | "nextSmaller" | "nextLarger";

export type LookupSearchMode = "first" | "last";

function requireCubeColumn(c: CubeValue, name: string): CubeColumn {
  const col = c.columns.find((k) => k.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  return col;
}

function inferCubeKeyType(col: CubeColumn): FrameColType {
  let sawNumber = false, sawBool = false, sawOther = false;
  for (const cell of col.cells) {
    if (cell === null || isSolError(cell)) continue;
    if (typeof cell === "number") sawNumber = true;
    else if (typeof cell === "boolean") sawBool = true;
    else sawOther = true;
  }
  if (sawOther || (sawNumber && sawBool)) return "string";
  if (sawNumber) return "number";
  if (sawBool) return "logical";
  return "string";
}

export function lookupCell(
  c: CubeValue, lookupColumn: string, returnColumn: string, lookup: string,
  matchMode: LookupMatchMode = "exact", searchMode: LookupSearchMode = "first",
): CubeCell | undefined {
  const idx = lookupRowIndex(c, lookupColumn, lookup, matchMode, searchMode);
  const ret = requireCubeColumn(c, returnColumn);
  if (idx < 0) return undefined;
  return idx < ret.cells.length ? ret.cells[idx] ?? null : null;
}

export function lookupRowIndex(
  c: CubeValue, lookupColumn: string, lookup: string,
  matchMode: LookupMatchMode = "exact", searchMode: LookupSearchMode = "first",
): number {
  const key = requireCubeColumn(c, lookupColumn);
  const keyType = key.type ?? inferCubeKeyType(key);
  if (matchMode !== "exact" && !isOrderableKey(keyType)) {
    throw solError("#VALUE!", "Approximate lookup requires a numeric or date column");
  }
  const needle = lookupNeedle(lookup, keyType);
  if (matchMode !== "exact" && !(typeof needle === "number" && Number.isFinite(needle))) return -1;
  const keys = key.cells.slice(0, cubeRowCount(c));
  const idx = xmatchIndex(needle, keys, NODE_TO_XMATCH_MODE[matchMode], searchMode);
  return isSolError(idx) ? -1 : idx;
}

export function frameRowAt(f: FrameValue, i: number): FrameValue {
  return reorderRows(f, [i]);
}

export function cubeRowAt(c: CubeValue, i: number): CubeValue {
  return cubeFromColumns(
    c.columns.map((col) => ({ name: col.name, type: col.type, cells: [i < col.cells.length ? col.cells[i] ?? null : null] })),
  );
}

export function asLookupSource(v: unknown): FrameValue | CubeValue | null {
  if (v == null) return null;
  if (isCubeValue(v)) return v;
  if (isFrameValue(v)) return v;
  if (Array.isArray(v)) return Array.isArray(v[0]) ? frameFromRows(v as unknown[][]) : frameFromRows([v as unknown[]]);
  return frameFromRows([[v]]);
}

// ─── Append / Union (n-ary) ────────────────────────────────────────────────────
export function appendFrames(frames: readonly FrameValue[]): FrameValue {
  const names: string[] = [];
  const typeOf = new Map<string, FrameColType>();
  for (const f of frames) {
    for (const c of f.columns) {
      const existing = typeOf.get(c.name);
      if (existing === undefined) { typeOf.set(c.name, c.type); names.push(c.name); }
      else if (existing !== c.type) {
        throw solError("#TYPE!", `append: column "${c.name}" is ${existing} in one frame and ${c.type} in another`);
      }
    }
  }
  return frame(names.map((name) => {
    const values: FrameCell[] = [];
    for (const f of frames) {
      const col = f.columns.find((c) => c.name === name);
      const rows = frameRowCount(f);
      for (let i = 0; i < rows; i++) values.push(col ? cellAt(col, i) : null);
    }
    return { name, type: typeOf.get(name)!, values };
  }));
}

export function bindColumns(frames: readonly FrameValue[]): FrameValue {
  const rows = Math.max(0, ...frames.map(frameRowCount));
  const all = frames.flatMap((f) => f.columns);
  const names = makeHeaders(all.map((c) => c.name), all.length);
  return frame(all.map((c, i) => {
    const values: FrameCell[] = [];
    for (let r = 0; r < rows; r++) values.push(cellAt(c, r));
    return { name: names[i], type: c.type, values };
  }));
}

/** The op as the native engine needs it, since the engine sees no units: an aggregate or window
 *  over readings names its reading scale, and a variance over a scaled linear unit its scale. */
export function withUnitScales(f: FrameValue, op: FrameOp): FrameOp {
  const unitOf = (name: string | undefined) => f.columns.find((c) => c.name === name)?.unit;
  const scaleOf = (name: string | undefined) => readingScaleOf(unitOf(name));
  if (op.kind === "groupBy") {
    return {
      ...op,
      aggs: op.aggs.map((a) => {
        const s = a.readingScale ?? scaleOf(a.column);
        if (s !== undefined) return { ...a, readingScale: s };
        const u = AGG_READINGS_DELTA[a.op] === 2 ? a.unitScale ?? linearScaleOf(unitOf(a.column)) : undefined;
        return u === undefined ? a : { ...a, unitScale: u };
      }),
    };
  }
  if (op.kind === "window") {
    const s = op.readingScale ?? scaleOf(op.column);
    return s === undefined ? op : { ...op, readingScale: s };
  }
  return op;
}

export function applyVerb(f: FrameValue, op: FrameOp): FrameValue {
  switch (op.kind) {
    case "select":   return selectColumns(f, op.columns);
    case "drop":     return dropColumns(f, op.columns);
    case "rename":   return renameColumns(f, op.map);
    case "sort":     return sortByColumn(f, op.by, op.dir);
    case "distinct": return distinctRows(f, op.columns);
    case "head":     return headRows(f, op.n);
    case "filter":   return filterRows(f, op.column, op.op, op.value, op.matchCase ?? false);
    case "filterMulti": return filterRowsMulti(f, op.combine, op.conditions, op.complement ?? false);
    case "groupBy":  return groupByFrame(f, op.keys, op.aggs);
    case "unpivot":  return unpivotFrame(f, op.idColumns, op.valueColumns, { variableName: op.variableName, valueName: op.valueName });
    case "pivot":    return pivotFrame(f, op);
    case "window":   return windowFrame(f, op);
    case "fillBlanks": return fillBlanks(f, op.columns, op.dir);
    case "replaceValues": return replaceValues(f, op.column, op.find, op.replaceWith, op.mode);
    case "sliceRows": return sliceRows(f, op.mode, op.n, op.to);
  }
}

// ─── Decision matrix (weighted scoring) ────────────────────────────────────────

export type DecisionNormalize = "none" | "max" | "rank";

function cellToScore(v: FrameCell): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

function normalizeColumn(vals: number[], mode: DecisionNormalize): number[] {
  if (mode === "none") return vals;
  if (mode === "max") {
    const denom = vals.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return denom === 0 ? vals.map(() => 0) : vals.map((v) => v / denom);
  }
  const n = vals.length;
  if (n <= 1) return vals.map(() => 1);
  return vals.map((v) => vals.filter((o) => o < v).length / (n - 1));
}

// Flattens −0 so a zero contribution under a negative weight never prints "-0".
const round4 = (n: number): number => {
  const r = Math.round(n * 1e4) / 1e4;
  return r === 0 ? 0 : r;
};

export function decisionColumns(f: FrameValue): { labelCol: FrameColumn | null; criteriaCols: FrameColumn[] } {
  const labelCol = f.columns.find((c) => c.type === "string") ?? null;
  const criteriaCols = f.columns.filter(
    (c) => c !== labelCol && (c.type === "number" || c.type === "logical"),
  );
  return { labelCol, criteriaCols };
}

export function decisionCriteria(f: FrameValue): string[] {
  return decisionColumns(f).criteriaCols.map((c) => c.name);
}

// ─── Criterion-keyed weights (a frame, not a list) ──────────────────────────────

const critKey = (s: string): string => s.trim().toLowerCase();

const criterionColumn = (f: FrameValue): FrameColumn | undefined => f.columns.find((c) => c.type === "string");

function criterionRowIndex(f: FrameValue): Map<string, number> {
  const m = new Map<string, number>();
  criterionColumn(f)?.values.forEach((v, i) => {
    if (typeof v === "string") { const k = critKey(v); if (k && !m.has(k)) m.set(k, i); }
  });
  return m;
}

const numOrNull = (v: FrameCell): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? (v ? 1 : 0) : null;

export function parseNormalize(v: FrameCell): DecisionNormalize | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[÷\s]/g, "");
  if (s === "raw" || s === "none") return "none";
  if (s === "max" || s === "divmax") return "max";
  if (s === "rank") return "rank";
  return null;
}

function normOverridesFrom(f: FrameValue, criteria: string[], rowIndex: Map<string, number>): Record<string, DecisionNormalize> {
  const critCol = criterionColumn(f);
  const normCol = f.columns.find((c) => c !== critCol && critKey(c.name) === "norm");
  const out: Record<string, DecisionNormalize> = {};
  if (!normCol) return out;
  for (const name of criteria) {
    const r = rowIndex.get(critKey(name));
    const m = r != null ? parseNormalize(normCol.values[r]) : null;
    if (m) out[name] = m;
  }
  return out;
}

export function resolveDecisionWeights(
  wf: FrameValue | null, criteria: string[],
): { weights: number[] | null; normOverrides: Record<string, DecisionNormalize> } {
  if (!wf) return { weights: null, normOverrides: {} };
  const rowIndex = criterionRowIndex(wf);
  const nums = wf.columns.filter((c) => c.type === "number");
  const weightCol = nums.find((c) => ["weight", "weights", "value"].includes(critKey(c.name))) ?? nums[0] ?? null;
  const weights = criteria.map((name) => {
    const r = rowIndex.get(critKey(name));
    const v = r != null && weightCol ? numOrNull(weightCol.values[r]) : null;
    return v ?? 1;
  });
  return { weights, normOverrides: normOverridesFrom(wf, criteria, rowIndex) };
}

export function allocateFrame(
  f: FrameValue, mode: AllocateMode, amount: number,
): FrameValue {
  const rows = frameRowCount(f);
  const byName = (...names: string[]): FrameColumn | undefined => {
    const set = new Set(names.map((n) => n.toLowerCase()));
    return f.columns.find((c) => set.has(c.name.trim().toLowerCase()));
  };
  const nums = f.columns.filter((c) => c.type === "number");
  const weightCol = byName("weight", "weights", "value");
  const priceNums = nums.filter((c) => c !== weightCol);
  const minCol = byName("min") ?? priceNums[0];
  const maxCol = byName("max") ?? priceNums.filter((c) => c !== minCol)[0];
  if (!minCol || !maxCol) {
    throw solError("#VALUE!", "Allocator needs a min and a max number column");
  }
  const nameCol = f.columns.find((c) => c.type === "string");
  const asNum = (cell: FrameCell, what: string): number => {
    if (isSolError(cell)) throw cell;
    if (typeof cell === "number" && Number.isFinite(cell)) return cell;
    throw solError("#VALUE!", `Allocator: every ${what} must be a number`);
  };
  const mins: number[] = [], maxs: number[] = [], weights: number[] = [], names: FrameCell[] = [];
  for (let i = 0; i < rows; i++) {
    mins.push(asNum(minCol.values[i] ?? null, "min"));
    maxs.push(asNum(maxCol.values[i] ?? null, "max"));
    const w = weightCol && typeof weightCol.values[i] === "number" ? (weightCol.values[i] as number) : 1;
    weights.push(typeof w === "number" && Number.isFinite(w) ? w : 1);
    names.push(nameCol ? (nameCol.values[i] ?? `Item ${i + 1}`) : `Item ${i + 1}`);
  }
  const alloc = allocate(mode, mins, maxs, weights, amount);
  const total = alloc.reduce((s, a) => s + a, 0);
  const share = alloc.map((a) => (total > 0 ? a / total : 0));
  return {
    __frame: true,
    columns: [
      { name: nameCol?.name ?? "Category", type: "string", values: names },
      { name: "Allocation", type: "number", values: alloc, ...(minCol.unit ? { unit: minCol.unit } : {}), ...(minCol.format ? { format: minCol.format } : {}) },
      { name: "Share", type: "number", values: share },
    ],
  };
}

export function decisionMatrix(
  f: FrameValue,
  weights: number[] | null,
  normalize: DecisionNormalize,
  breakdown = false,
  normalizeOverrides: Record<string, DecisionNormalize> = {},
): FrameValue {
  const rows = frameRowCount(f);

  const { labelCol, criteriaCols } = decisionColumns(f);
  if (criteriaCols.length === 0) {
    throw solError("#VALUE!", "Decision Matrix needs at least one numeric criterion column");
  }
  for (const c of criteriaCols) {
    for (const v of c.values) if (isSolError(v)) throw v;
  }

  const labels: FrameCell[] = labelCol
    ? Array.from({ length: rows }, (_, i) => labelCol.values[i] ?? null)
    : Array.from({ length: rows }, (_, i) => `Option ${i + 1}`);

  const effective = criteriaCols.map((c) =>
    normalizeColumn(
      Array.from({ length: rows }, (_, i) => cellToScore(c.values[i])),
      normalizeOverrides[c.name] ?? normalize,
    ),
  );

  const weightOf = (j: number): number => {
    const w = weights?.[j];
    return typeof w === "number" && Number.isFinite(w) ? w : 1;
  };
  let sumAbsW = 0;
  for (let j = 0; j < criteriaCols.length; j++) sumAbsW += Math.abs(weightOf(j));

  const scores: number[] = Array.from({ length: rows }, (_, i) => {
    let sw = 0;
    for (let j = 0; j < criteriaCols.length; j++) sw += effective[j][i] * weightOf(j);
    return round4(sumAbsW > 0 ? sw / sumAbsW : 0);
  });

  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const rankByRow = new Array<number>(rows).fill(0);
  for (let k = 0; k < order.length; k++) {
    rankByRow[order[k].i] =
      k > 0 && order[k].s === order[k - 1].s ? rankByRow[order[k - 1].i] : k + 1;
  }

  const idx = order.map((o) => o.i);
  const out: FrameColumn[] = [
    { name: labelCol?.name ?? "Option", type: "string", values: idx.map((i) => labels[i]) },
  ];
  if (breakdown) {
    criteriaCols.forEach((c, j) => {
      const w = weightOf(j);
      out.push({ name: c.name, type: "number", values: idx.map((i) => round4(sumAbsW > 0 ? (effective[j][i] * w) / sumAbsW : 0)) });
    });
  }
  out.push({ name: "Score", type: "number", values: idx.map((i) => scores[i]) });
  out.push({ name: "Rank", type: "number", values: idx.map((i) => rankByRow[i]) });

  const names = makeHeaders(out.map((c) => c.name), out.length);
  return { __frame: true, columns: out.map((c, k) => ({ ...c, name: names[k] })) };
}

// ─── Decision matrix sensitivity (weight scenarios → a Cube of rankings) ────────
export function decisionSensitivity(
  scores: FrameValue,
  scenarios: FrameValue,
  normalize: DecisionNormalize,
): CubeValue {
  const criteria = decisionCriteria(scores);
  if (criteria.length === 0) {
    throw solError("#VALUE!", "Decision Matrix needs at least one numeric criterion column");
  }

  const rowIndex = criterionRowIndex(scenarios);
  const scenarioCols = scenarios.columns.filter((c) => c.type === "number");
  if (scenarioCols.length === 0) {
    throw solError("#VALUE!", "Scenarios needs a number column per scenario");
  }
  if (!criteria.some((name) => rowIndex.has(critKey(name)))) {
    throw solError("#VALUE!", "No Scenarios row is named after a criterion");
  }
  const normOverrides = normOverridesFrom(scenarios, criteria, rowIndex);

  const scenarioCells: CubeCell[] = [];
  const winnerCells: CubeCell[] = [];
  const marginCells: CubeCell[] = [];
  const rankingCells: CubeCell[] = [];

  for (const scenCol of scenarioCols) {
    const weights = criteria.map((name) => {
      const r = rowIndex.get(critKey(name));
      const v = r != null ? numOrNull(scenCol.values[r]) : null;
      return v ?? 1;
    });
    const ranking = decisionMatrix(scores, weights, normalize, false, normOverrides);
    // Positional: with breakdown off the shape is label · Score · Rank, and a criterion named "Score" would defeat a lookup by name.
    const scoreCol = ranking.columns[1];
    const rankCol = ranking.columns[2];
    const top = typeof scoreCol.values[0] === "number" ? scoreCol.values[0] : null;
    const second = typeof scoreCol.values[1] === "number" ? scoreCol.values[1] : null;

    scenarioCells.push(scenCol.name);
    const tied = ranking.columns[0].values.filter((_, k) => rankCol.values[k] === 1);
    winnerCells.push(tied.length > 1 ? tied.map((v) => String(v ?? "")).join(" = ") : (tied[0] ?? null));
    marginCells.push(top !== null && second !== null ? round4(top - second) : null);
    rankingCells.push(ranking);
  }

  return cubeFromColumns([
    { name: "Scenario", cells: scenarioCells },
    { name: "Winner", cells: winnerCells },
    { name: "Margin", cells: marginCells },
    { name: "Ranking", cells: rankingCells },
  ]);
}

// ─── Timesaver verbs ─────────────────────────────────────────────────────────────

export function fillBlanks(f: FrameValue, columns: readonly string[], dir: "down" | "up"): FrameValue {
  const targets = new Set((columns.length ? columns.map((c) => requireColumn(f, c)) : f.columns).map((c) => c.name));
  const cols = f.columns.map((col) => {
    if (!targets.has(col.name)) return col;
    const values = [...col.values];
    if (dir === "down") {
      let carry: FrameCell = null;
      for (let i = 0; i < values.length; i++) {
        if (values[i] == null) values[i] = carry;
        else carry = values[i];
      }
    } else {
      let carry: FrameCell = null;
      for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] == null) values[i] = carry;
        else carry = values[i];
      }
    }
    return { ...withoutRaw(col), values };
  });
  return { __frame: true, columns: cols };
}

function coerceReplacement(t: FrameColType, text: string): FrameCell | undefined {
  const s = text.trim();
  if (s === "") return null;
  switch (t) {
    case "number":
    case "date": { const n = decimalFromText(s); return Number.isFinite(n) ? n : undefined; }
    case "logical": {
      const l = s.toLowerCase();
      return l === "true" || l === "1" ? true : l === "false" || l === "0" ? false : null;
    }
    default: return text;
  }
}

export function replaceValues(
  f: FrameValue, column: string, find: string, replaceWith: string, mode: "cell" | "substring",
): FrameValue {
  if (find === "") return f;
  const targets = new Set((column.trim() ? [requireColumn(f, column.trim())] : f.columns).map((c) => c.name));
  const findNum = decimalFromText(find);
  const numericFind = Number.isFinite(findNum);
  const cols = f.columns.map((col) => {
    if (!targets.has(col.name)) return col;
    if (mode === "substring") {
      if (col.type !== "string") return col;
      return {
        ...withoutRaw(col),
        values: col.values.map((v) => (typeof v === "string" ? v.split(find).join(replaceWith) : v)),
      };
    }
    const replacement = coerceReplacement(col.type, replaceWith);
    if (replacement === undefined) return col;
    return {
      ...withoutRaw(col),
      values: col.values.map((v) => {
        if (v == null || isSolError(v)) return v;
        const hit = typeof v === "number"
          ? numericFind && v === findNum
          : typeof v === "boolean"
            ? (v ? "TRUE" : "FALSE") === find.toUpperCase()
            : String(v) === find;
        return hit ? replacement : v;
      }),
    };
  });
  return { __frame: true, columns: cols };
}

export function mergeColumns(f: FrameValue, columns: readonly string[], separator: string, name: string): FrameValue {
  const sources = columns.map((c) => requireColumn(f, c));
  if (sources.length < 2) throw solError("#VALUE!", "Merge needs at least two columns");
  const rows = frameRowCount(f);
  const values: FrameCell[] = [];
  for (let i = 0; i < rows; i++) {
    values.push(sources.map((c) => {
      const v = c.values[i];
      if (v == null) return "";
      const t = formatFrameCell(c.type, v);
      return t == null ? "" : String(t);
    }).join(separator));
  }
  const drop = new Set(sources.map((c) => c.name));
  const at = f.columns.findIndex((c) => c.name === sources[0].name);
  const kept = f.columns.filter((c) => !drop.has(c.name));
  const keptBefore = f.columns.slice(0, at).filter((c) => !drop.has(c.name)).length;
  const merged: FrameColumn = { name: (name ?? "").trim() || "Merged", type: "string", values };
  const out = [...kept.slice(0, keptBefore), merged, ...kept.slice(keptBefore)];
  return { __frame: true, columns: out.map((c, i) => ({ ...c, name: makeHeaders(out.map((x) => x.name), out.length)[i] })) };
}

export function promoteHeaders(f: FrameValue): FrameValue {
  if (frameRowCount(f) === 0) return f;
  const names = f.columns.map((c) => {
    const v = c.values[0];
    if (v == null || isSolError(v)) return "";
    return String(formatFrameCell(c.type, v) ?? "").trim();
  });
  const unique = makeHeaders(names, f.columns.length);
  return { __frame: true, columns: f.columns.map((c, i) => ({
    ...c, name: unique[i], values: c.values.slice(1), ...(c.raw ? { raw: c.raw.slice(1) } : {}),
  })) };
}

export function demoteHeaders(f: FrameValue): FrameValue {
  const columns: FrameColumn[] = f.columns.map((c, i) => ({
    name: `Col${i + 1}`,
    type: "string",
    values: [c.name, ...c.values.map((v) => {
      if (v == null || isSolError(v)) return v;
      return String(formatFrameCell(c.type, v) ?? "");
    })],
  }));
  return { __frame: true, columns };
}

export function dropBlankRows(f: FrameValue, mode: "all" | "any"): FrameValue {
  const rows = frameRowCount(f);
  const keep: number[] = [];
  for (let i = 0; i < rows; i++) {
    const blanks = f.columns.filter((c) => c.values[i] == null).length;
    const drop = mode === "all" ? blanks === f.columns.length : blanks > 0;
    if (!drop) keep.push(i);
  }
  return { __frame: true, columns: f.columns.map((c) => ({ ...withoutRaw(c), values: keep.map((i) => c.values[i] ?? null) })) };
}

export function sliceBounds(rows: number, mode: "first" | "last" | "skip" | "range", n: number, to?: number): [number, number] {
  const N = Math.max(0, Math.trunc(n));
  let start = 0, end = rows;
  if (mode === "first") end = Math.min(rows, N);
  else if (mode === "last") start = Math.max(0, rows - N);
  else if (mode === "skip") start = Math.min(rows, N);
  else { start = Math.max(0, Math.trunc(n) - 1); end = Math.min(rows, Math.trunc(to ?? n)); }
  if (end < start) end = start;
  return [start, end];
}

export function sliceRows(f: FrameValue, mode: "first" | "last" | "skip" | "range", n: number, to?: number): FrameValue {
  const [start, end] = sliceBounds(frameRowCount(f), mode, n, to);
  return { __frame: true, columns: f.columns.map((c) => ({ ...withoutRaw(c), values: c.values.slice(start, end) })) };
}

// ─── Describe (pandas describe / R summary) — one row per column ──────────────
export interface ColumnProfile {
  count: number; blank: number; error: number; distinct: number;
  mean: number | null; std: number | null; min: number | null;
  q25: number | null; median: number | null; q75: number | null; max: number | null;
}

export function describeColumn(values: readonly unknown[], type: FrameColType | undefined): ColumnProfile {
  const present = values.filter((v) => v != null);
  const profile: ColumnProfile = {
    count: present.length,
    blank: values.length - present.length,
    error: present.filter((v) => isSolError(v)).length,
    distinct: new Set(present.filter((v) => !isSolError(v)).map((v) => (typeof v === "number" ? `#${v}` : typeof v === "boolean" ? `b${v}` : `s${String(v)}`))).size,
    mean: null, std: null, min: null, q25: null, median: null, q75: null, max: null,
  };
  if (type === "number" || type === "date") {
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const stat = (op: "avg" | "stdev" | "min" | "max"): number | null => { const r = aggregate(op, nums); return typeof r === "number" ? r : null; };
    const pct = (p: number): number | null => { const r = percentile(nums, p, false); return typeof r === "number" ? r : null; };
    profile.mean = type === "number" ? stat("avg") : null;
    profile.std = type === "number" ? stat("stdev") : null;
    profile.min = stat("min");
    profile.q25 = type === "number" ? pct(0.25) : null;
    profile.median = type === "number" ? pct(0.5) : null;
    profile.q75 = type === "number" ? pct(0.75) : null;
    profile.max = stat("max");
  }
  return profile;
}

export function describeFrame(f: FrameValue): FrameValue {
  const names: string[] = [], types: string[] = [], count: number[] = [], blank: number[] = [], distinct: number[] = [];
  const mean: (number | null)[] = [], std: (number | null)[] = [], min: (number | null)[] = [], q25: (number | null)[] = [],
    q50: (number | null)[] = [], q75: (number | null)[] = [], max: (number | null)[] = [];
  for (const c of f.columns) {
    names.push(c.name); types.push(c.type);
    const p = describeColumn(c.values, c.type);
    count.push(p.count); blank.push(p.blank); distinct.push(p.distinct);
    mean.push(p.mean); std.push(p.std); min.push(p.min);
    q25.push(p.q25); q50.push(p.median); q75.push(p.q75); max.push(p.max);
  }
  return { __frame: true, columns: [
    { name: "column", type: "string", values: names },
    { name: "type", type: "string", values: types },
    { name: "count", type: "number", values: count },
    { name: "blank", type: "number", values: blank },
    { name: "distinct", type: "number", values: distinct },
    { name: "mean", type: "number", values: mean },
    { name: "std", type: "number", values: std },
    { name: "min", type: "number", values: min },
    { name: "25%", type: "number", values: q25 },
    { name: "50%", type: "number", values: q50 },
    { name: "75%", type: "number", values: q75 },
    { name: "max", type: "number", values: max },
  ] };
}

export type CorrMethod = "pearson" | "spearman" | "kendall" | "covariance";

export function correlationMatrix(f: FrameValue, method: CorrMethod): FrameValue {
  const cols = f.columns.filter((c) => c.type === "number");
  const vals = cols.map((c) => c.values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)));
  const cell = (i: number, j: number): number | null => {
    const xs: number[] = [], ys: number[] = [];
    const n = Math.min(vals[i].length, vals[j].length);
    for (let r = 0; r < n; r++) { const a = vals[i][r], b = vals[j][r]; if (a !== null && b !== null) { xs.push(a); ys.push(b); } }
    const v = method === "pearson" ? pearson(xs, ys)
      : method === "spearman" ? spearman(xs, ys)
      : method === "kendall" ? kendallTau(xs, ys)
      : covariance(xs, ys, true);
    return typeof v === "number" ? v : null;
  };
  const out: FrameColumn[] = [{ name: "column", type: "string", values: cols.map((c) => c.name) }];
  cols.forEach((cj, j) => out.push({ name: cj.name, type: "number", values: cols.map((_, i) => cell(i, j)) }));
  return { __frame: true, columns: out };
}

// ─── Window functions by group ─────────────────────────────────────────────────
export type WindowFn =
  | "row_number" | "rank" | "dense_rank" | "percent_rank" | "ntile"
  | "cumsum" | "cumavg" | "cummin" | "cummax" | "cumcount"
  | "lag" | "lead" | "diff" | "pct_change"
  | "rolling_sum" | "rolling_avg" | "rolling_min" | "rolling_max"
  | "group_sum" | "group_avg" | "group_min" | "group_max" | "group_count" | "share" | "first" | "last";

const WINDOW_UNIT_KEEPING: ReadonlySet<WindowFn> = new Set([
  "cumsum", "cumavg", "cummin", "cummax", "lag", "lead", "diff",
  "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
  "group_sum", "group_avg", "group_min", "group_max", "first", "last",
]);

export interface WindowSpec {
  /** As on `AggSpec`: the column holds readings on an offset scale. */
  readingScale?: number;
  partitionBy: string[];
  orderBy?: string;
  orderDir?: "asc" | "desc";
  fn: WindowFn;
  column?: string;
  as: string;
  n?: number;
}

export const PCT_CHANGE_FROM_ZERO = "Percent change from zero is undefined";
export const ZERO_GROUP_TOTAL = "The group total is 0";

const WINDOW_READINGS_REFUSED: Partial<Record<WindowFn, string>> = {
  cumsum: READINGS_ADD, rolling_sum: READINGS_ADD, group_sum: READINGS_ADD, share: READINGS_SCALE, pct_change: READINGS_SCALE,
};

export const WINDOW_FN_NEEDS_COLUMN: ReadonlySet<WindowFn> = new Set([
  "cumsum", "cumavg", "cummin", "cummax", "lag", "lead", "diff", "pct_change",
  "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
  "group_sum", "group_avg", "group_min", "group_max", "group_count", "share", "first", "last",
]);
export const WINDOW_FN_NEEDS_N: ReadonlySet<WindowFn> = new Set(["lag", "lead", "rolling_sum", "rolling_avg", "rolling_min", "rolling_max", "ntile"]);

const WINDOW_FNS: ReadonlySet<string> = new Set<WindowFn>([
  "row_number", "rank", "dense_rank", "percent_rank", "ntile",
  "cumsum", "cumavg", "cummin", "cummax", "cumcount",
  "lag", "lead", "diff", "pct_change",
  "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
  "group_sum", "group_avg", "group_min", "group_max", "group_count", "share", "first", "last",
]);

export function selectCubeColumns(cube: CubeValue, names: readonly string[], op: "keep" | "drop"): CubeValue {
  if (op === "drop") return cubeFromColumns(cube.columns.filter((c) => !names.includes(c.name)));
  return cubeFromColumns(names.map((n) => {
    const c = cube.columns.find((cc) => cc.name === n);
    if (!c) throw solError("#REF!", `column "${n}" not found`);
    return c;
  }));
}

export function windowCube(cube: CubeValue, spec: WindowSpec): CubeValue {
  const read = [...new Set([...spec.partitionBy, spec.orderBy, spec.column].filter((c): c is string => !!c))];
  // Carries the row count when the function reads no column (row_number).
  const ROW = "\u0000row";
  const rows = cubeRowCount(cube);
  const flat: FrameValue = {
    __frame: true,
    columns: [{ name: ROW, type: "number", values: Array.from({ length: rows }, (_, i) => i) }, ...read.map((n) => cubeScalarColumn(cube, n))],
  };
  const outCols = windowFrame(flat, spec).columns;
  const outCol = outCols[outCols.length - 1];
  const kept = cube.columns.filter((c) => c.name !== outCol.name);
  return cubeFromColumns([...kept, { name: outCol.name, cells: cubeCellsFromColumn(outCol), type: outCol.type }]);
}

export function windowFrame(f: FrameValue, spec: WindowSpec): FrameValue {
  if (!WINDOW_FNS.has(spec.fn)) throw solError("#VALUE!", `unknown window function "${spec.fn}"`);
  const n = frameRowCount(f);
  const keyCols = spec.partitionBy.map((k) => requireColumn(f, k));
  const orderCol = spec.orderBy ? requireColumn(f, spec.orderBy) : null;
  const valCol = WINDOW_FN_NEEDS_COLUMN.has(spec.fn) ? requireColumn(f, spec.column ?? "") : null;
  const N = Math.max(1, Math.round(spec.n ?? 1));
  const parts = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = JSON.stringify(keyCols.map((c) => encodeCell(cellAt(c, i))));
    const arr = parts.get(k); if (arr) arr.push(i); else parts.set(k, [i]);
  }
  const out: FrameCell[] = new Array<FrameCell>(n).fill(null);
  const cmp = (a: FrameCell, b: FrameCell): number => {
    if (typeof a === "number" && typeof b === "number") return compareNumbers(a, b);
    if (typeof a === "string" && typeof b === "string") return compareStrings(a, b);
    if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };
  for (const rows of parts.values()) {
    const blankKey = (k: FrameCell) => k == null || isSolError(k) || (typeof k === "number" && Number.isNaN(k));
    let ordered = rows;
    if (orderCol) {
      const dir = spec.orderDir === "desc" ? -1 : 1;
      ordered = [...rows].sort((i, j) => {
        const a = cellAt(orderCol, i), b = cellAt(orderCol, j);
        const aBlank = blankKey(a), bBlank = blankKey(b);
        if (aBlank || bBlank) return aBlank === bBlank ? i - j : aBlank ? 1 : -1;
        const c = cmp(a, b) * dir;
        return c !== 0 ? c : i - j;
      });
    }
    const vals = valCol ? ordered.map((i) => cellAt(valCol, i)) : [];
    const err = vals.find(isSolError);
    const nums = vals.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" && !Number.isNaN(v) ? v : null));
    const present = nums.filter((v): v is number => v !== null);
    const orderVals = orderCol ? ordered.map((i) => cellAt(orderCol, i)) : [];
    const m = ordered.length;
    const minOf = (xs: readonly number[]) => xs.reduce((a, b) => (b < a ? b : a));
    const maxOf = (xs: readonly number[]) => xs.reduce((a, b) => (b > a ? b : a));
    const groupAgg = (): FrameCell => {
      if (!spec.fn.startsWith("group_")) return null;
      if (err) return err;
      if (present.length === 0) return spec.fn === "group_count" ? 0 : null;
      switch (spec.fn) {
        case "group_sum":   return present.reduce((a, b) => a + b, 0);
        case "group_avg":   return present.reduce((a, b) => a + b, 0) / present.length;
        case "group_min":   return minOf(present);
        case "group_max":   return maxOf(present);
        case "group_count": return present.length;
        default: return null;
      }
    };
    const groupValue = groupAgg();
    const total = present.reduce((a, b) => a + b, 0);
    const ranked = orderVals.filter((k) => !blankKey(k)).length;
    let runStart = 0, dense = 0;
    let cumSum = 0, cumCount = 0, cumMin = Infinity, cumMax = -Infinity;
    for (let p = 0; p < m; p++) {
      const row = ordered[p];
      let v: FrameCell = null;
      if (orderCol && (p === 0 || cmp(orderVals[p], orderVals[p - 1]) !== 0)) { runStart = p; dense++; }
      const x = nums[p];
      if (x !== null) { cumSum += x; cumCount++; if (x < cumMin) cumMin = x; if (x > cumMax) cumMax = x; }
      switch (spec.fn) {
        case "row_number": v = p + 1; break;
        case "rank": case "dense_rank": case "percent_rank": {
          if (!orderCol) { v = spec.fn === "percent_rank" ? (m > 1 ? p / (m - 1) : 0) : p + 1; break; }
          if (blankKey(orderVals[p])) { v = null; break; }
          v = spec.fn === "dense_rank" ? dense : spec.fn === "rank" ? runStart + 1 : (ranked > 1 ? runStart / (ranked - 1) : 0);
          break;
        }
        case "ntile": v = Math.floor((p * N) / m) + 1; break;
        case "cumcount": v = p + 1; break;
        case "cumsum": case "cumavg": case "cummin": case "cummax": {
          if (err) { v = err; break; }
          if (x === null) { v = null; break; }
          v = spec.fn === "cumsum" ? cumSum
            : spec.fn === "cumavg" ? cumSum / cumCount
            : spec.fn === "cummin" ? cumMin : cumMax;
          break;
        }
        case "lag": v = p - N >= 0 ? vals[p - N] : null; break;
        case "lead": v = p + N < m ? vals[p + N] : null; break;
        case "diff": case "pct_change": {
          const prev = p >= 1 ? nums[p - 1] : null;
          if (err) { v = err; break; }
          if (x === null || prev === null) { v = null; break; }
          v = spec.fn === "diff" ? x - prev : prev === 0 ? solError("#DIV/0!", PCT_CHANGE_FROM_ZERO) : (x - prev) / prev;
          break;
        }
        case "rolling_sum": case "rolling_avg": case "rolling_min": case "rolling_max": {
          if (err) { v = err; break; }
          if (p < N - 1 || x === null) { v = null; break; }
          const win = nums.slice(p - N + 1, p + 1).filter((y): y is number => y !== null);
          v = spec.fn === "rolling_sum" ? win.reduce((a, b) => a + b, 0)
            : spec.fn === "rolling_avg" ? win.reduce((a, b) => a + b, 0) / win.length
            : spec.fn === "rolling_min" ? minOf(win) : maxOf(win);
          break;
        }
        case "group_sum": case "group_avg": case "group_min": case "group_max": case "group_count": v = groupValue; break;
        case "share": {
          if (err) { v = err; break; }
          v = x === null ? null : total === 0 ? solError("#DIV/0!", ZERO_GROUP_TOTAL) : x / total;
          break;
        }
        case "first": v = err ?? (vals.length ? vals[0] : null); break;
        case "last":  v = err ?? (vals.length ? vals[m - 1] : null); break;
      }
      out[row] = v;
    }
  }
  const outType: FrameColType =
    (spec.fn === "lag" || spec.fn === "lead" || spec.fn === "first" || spec.fn === "last") && valCol ? valCol.type : "number";
  const name = spec.as.trim() || spec.fn;
  const plan: ReadingPlan = valCol
    ? readingPlan(valCol.unit, spec.readingScale, WINDOW_READINGS_REFUSED[spec.fn], spec.fn === "diff" ? 1 : undefined, WINDOW_UNIT_KEEPING.has(spec.fn))
    : { cell: (v) => v };
  return {
    __frame: true,
    columns: [...f.columns.filter((c) => c.name !== name), { name, type: outType, ...(plan.unit ? { unit: plan.unit } : {}), values: out.map(plan.cell) }],
  };
}
