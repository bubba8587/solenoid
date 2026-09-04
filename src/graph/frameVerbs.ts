// ─── Relational verbs — the pure engine ───────────────────────────────────────
// Also the reference oracle the Polars backend is parity-tested against. Verbs never
// mutate their input; a structural failure THROWS a tagged SolError (#REF!).
import {
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
  type CubeValue, type CubeColumn, type CubeCell,
  frameRowCount, makeHeaders, cubeFromColumns, cubeRowCount, inferColumn, isFrameValue,
  isCubeValue, frameFromRows, formatFrameCell,
} from "./frame";
import { isSolError, solError } from "./errorValue";
import { forAggregate, coerceLogical, guardFinite } from "./valueKinds";
import { compareStrings } from "./stringOrder";
import { compareOp, type ComparisonOp } from "./nodes/logic";
import { xmatchIndex, type XMatchMatchMode } from "./nodes/listOps";
import { allocate, type AllocateMode } from "./nodes/allocateOps";
import { aggregate, percentile, pearson, spearman, kendallTau, covariance } from "./nodes/statsOps";
import { parseDateToSerial } from "./nodes/dateSerial";

/** Group-aggregation ops (the GroupBy / PivotBy core). count = non-null cells
 *  (COUNTA); sum/avg/min/max/product/median/mode/stdev/var skip null and
 *  propagate a per-cell error (via forAggregate). `percentof` is the two-argument
 *  PIVOTBY op SUM(subset)/SUM(totalset) — it is resolved at pivot assembly (it
 *  needs the relative total set), not by `aggregateGroup`, which returns null for
 *  it. */
export type AggOp =
  | "sum" | "avg" | "min" | "max" | "count"
  | "product" | "median" | "mode" | "stdev" | "stdevp" | "var" | "varp"
  | "percentof";

/** Filter operators: the six shared comparisons (reused from Comparison/Filter so
 *  semantics never drift), three text predicates, the blank pair, and the ERROR
 *  pair (`iserror` keeps error cells, `noterror` drops them — the way to strip
 *  #DIV/0!/#N/A/… out of a list/frame). The error pair is JS-oracle only: the
 *  native Polars engine degrades a per-cell error to null on upload, so the frame
 *  Filter routes an error-predicate through the oracle rather than the plan. */
export type FilterOp = ComparisonOp | "contains" | "startsWith" | "endsWith" | "isblank" | "notblank" | "iserror" | "noterror";

/** The value-less filter ops — no comparison value (the Value field hides). Shared
 *  so the node data() paths and the UI agree. */
export const VALUELESS_FILTER_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>(["isblank", "notblank", "iserror", "noterror"]);

/** The error predicates — the frame Filter runs these in the JS oracle (the native
 *  engine can't hold per-cell errors). */
export const ERROR_FILTER_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>(["iserror", "noterror"]);

/** One predicate of a multi-condition filter (B-2). `matchCase` rides
 *  PER-CONDITION — "Region eq west (any case) AND Code contains X (exact)". */
export interface FilterCond { column: string; op: FilterOp; value: FrameCell; matchCase?: boolean }
/** Per-row {op, matchCase} config, shared by every condition-row card (the
 *  frame Filter, the 1-D Filter, SUMIFS). */
export interface FilterCondConfig { op: FilterOp; matchCase?: boolean }
export type FilterCombine = "and" | "or";

/** The verb set. Unary ops compose via `applyVerb`; binary ops (join, append)
 *  have their own entry points since they take two frames. Grows per increment. */
export type FrameOp =
  | { kind: "select"; columns: string[] }            // keep these columns, in this order
  | { kind: "drop"; columns: string[] }              // remove these columns (unknowns ignored)
  | { kind: "rename"; map: Record<string, string> }  // old name → new name
  | { kind: "sort"; by: string; dir: "asc" | "desc" } // order rows by one column
  | { kind: "distinct"; columns?: string[] }         // unique rows (on these cols, or all)
  | { kind: "head"; n: number }                      // first n rows
  | { kind: "filter"; column: string; op: FilterOp; value: FrameCell; matchCase?: boolean } // keep rows passing a predicate
  | { kind: "filterMulti"; combine: FilterCombine; conditions: FilterCond[]; complement?: boolean } // keep rows passing ALL ("and") / ANY ("or") predicates; complement keeps the REST
  | { kind: "groupBy"; keys: string[]; aggs: AggSpec[] } // one row per key combo + aggregates
  | { kind: "unpivot"; idColumns: string[]; valueColumns: string[]; variableName?: string; valueName?: string } // wide → long
  | ({ kind: "pivot" } & PivotSpec)  // long → wide cross-tab (Excel PIVOTBY)
  | ({ kind: "window" } & WindowSpec) // one per-group window column, original row order
  | { kind: "fillBlanks"; columns: string[]; dir: "down" | "up" }   // carry the last value into blanks
  | { kind: "replaceValues"; column: string; find: string; replaceWith: string; mode: "cell" | "substring" }
  | { kind: "sliceRows"; mode: "first" | "last" | "skip" | "range"; n: number; to?: number };

/** Pinned to the TYPE below, so a `FrameOp` kind missing here fails `tsc` and the
 *  parity corpus then demands its fixture file. */
export const FRAME_OP_KINDS = [
  "select", "drop", "rename", "sort", "distinct", "head",
  "filter", "filterMulti", "groupBy", "unpivot", "pivot", "window", "fillBlanks", "replaceValues", "sliceRows",
] as const satisfies readonly FrameOp["kind"][];
// Exhaustiveness: a FrameOp kind missing from FRAME_OP_KINDS makes this `never`
// assignment fail to compile.
type _MissingFrameOpKind = Exclude<FrameOp["kind"], (typeof FRAME_OP_KINDS)[number]>;
const _frameOpKindsExhaustive: _MissingFrameOpKind[] = [] satisfies never[];
void _frameOpKindsExhaustive;

/** One aggregation in a groupBy: aggregate `column` with `op`, output as `as`. */
export interface AggSpec { column: string; op: AggOp; as: string; }

const frame = (columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });

function requireColumn(f: FrameValue, name: string): FrameColumn {
  const col = f.columns.find((c) => c.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  return col;
}

const cellAt = (col: FrameColumn, i: number): FrameCell =>
  i < col.values.length ? col.values[i] : null;

/** Re-materialize a frame from a row-index list (the basis for every row verb:
 *  sort = sorted indices, head = a prefix, distinct/filter = the kept indices).
 *  Drops `raw` (the per-column source text — a reordered/filtered frame is
 *  derived, so it has no source text). Short columns pad with `null`. */
export function reorderRows(f: FrameValue, indices: readonly number[]): FrameValue {
  return frame(f.columns.map((c) => {
    const { raw: _raw, ...rest } = c;
    return { ...rest, values: indices.map((i) => cellAt(c, i)) };
  }));
}

/** Within-type comparator for the SORTABLE (non-null, non-error) cells of a
 *  column. Numbers and dates compare numerically (a date IS a serial), strings
 *  by BYTE order (compareStrings — matches the Polars backend), logicals
 *  false<true. */
function comparatorFor(type: FrameColType): (a: FrameCell, b: FrameCell) => number {
  switch (type) {
    case "string": return (a, b) => compareStrings(String(a), String(b));
    case "logical": return (a, b) => (a ? 1 : 0) - (b ? 1 : 0);
    default: return (a, b) => (a as number) - (b as number); // number | date
  }
}

/** A JSON-safe, type-distinguishing encoding of a cell, for distinct/group keys
 *  (so `1` ≠ `"1"`, `null` ≠ `0`, and an error keys by its code).
 *  Non-finites key by NAME because `JSON.stringify` writes all three as `null`,
 *  which used to file +∞, −∞ and NaN into one shared bucket — sort orders ±∞ at
 *  opposite ends and aggregation reads NaN as `#DOMAIN!` while passing ±∞
 *  through, so one bucket was the odd surface out. */
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

/** Order rows by one column. Blanks (`null`) and per-cell errors sort LAST in
 *  both directions (Excel's blanks-last), stably; present values flip with dir.
 *  Stable on ties. */
export function sortByColumn(f: FrameValue, by: string, dir: "asc" | "desc"): FrameValue {
  const col = requireColumn(f, by);
  const cmp = comparatorFor(col.type);
  // NaN joins the tail: a `(a-b)` comparator makes NaN ordering depend on input
  // order (every comparison is false). ±Inf sorts normally (a real magnitude).
  const isTail = (i: number) => {
    const v = cellAt(col, i);
    return v === null || isSolError(v) || (typeof v === "number" && Number.isNaN(v));
  };
  const idx = Array.from({ length: frameRowCount(f) }, (_, i) => i);
  idx.sort((i, j) => {
    const ti = isTail(i), tj = isTail(j);
    if (ti || tj) return ti && tj ? i - j : ti ? 1 : -1; // tail last, stable
    const c = cmp(cellAt(col, i), cellAt(col, j));
    return c !== 0 ? (dir === "desc" ? -c : c) : i - j;  // stable on ties
  });
  return reorderRows(f, idx);
}

/** Keep the first occurrence of each unique row (on `columns`, or all columns).
 *  Two `null`s are equal; an error keys by its code. */
export function distinctRows(f: FrameValue, columns?: readonly string[]): FrameValue {
  const cols = (columns ?? f.columns.map((c) => c.name)).map((n) => requireColumn(f, n));
  const seen = new Set<string>();
  const keep: number[] = [];
  for (let i = 0; i < frameRowCount(f); i++) {
    const key = JSON.stringify(cols.map((c) => encodeCell(cellAt(c, i))));
    if (!seen.has(key)) { seen.add(key); keep.push(i); }
  }
  return reorderRows(f, keep);
}

/** The first `n` rows (n ≤ 0 → empty; n ≥ rowCount → unchanged). */
export function headRows(f: FrameValue, n: number): FrameValue {
  const take = Math.max(0, Math.min(Math.trunc(n), frameRowCount(f)));
  return reorderRows(f, Array.from({ length: take }, (_, i) => i));
}

/** Evenly-strided rows, NEVER random, so the same input always yields the same sample;
 *  order is preserved and a frame at or under `n` rows comes back unchanged. */
export function sampleFrame(f: FrameValue, n: number): FrameValue {
  const total = frameRowCount(f);
  if (total <= n || n <= 0) return f;
  const stride = total / n;
  const idx = Array.from({ length: n }, (_, i) => Math.min(total - 1, Math.floor(i * stride)));
  return reorderRows(f, idx);
}

/** Does one cell pass the predicate? A `null` or error cell is EXCLUDED (SQL
 *  WHERE keeps only TRUE — matches FilterNode). Comparisons reuse `compareOp`:
 *  numeric/date numerically, logical via 0/1, string via BYTE order (compareStrings);
 *  text ops match on the stringified cell. TEXT MATCHING (string eq/neq + the
 *  three text predicates) is case-INsensitive unless `matchCase` — Filter
 *  matches like Excel's `=` (FILTER/AutoFilter); keys (Join/Group By/Distinct)
 *  stay identity, case-sensitive. String lt/gt ordering is untouched. */
/** Coerce the (usually string) filter VALUE for a numeric comparison, by column
 *  type — the ONE spec both engines implement. Logical columns go through coerceLogical (TRUE/FALSE/0/1 and the number
 *  bridge); number/date parse after a trim, with NO comma stripping. `null` =
 *  not comparable → the predicate matches no rows (deterministic, and visibly
 *  "misconfigured" rather than silently keeping or dropping everything). */
function filterValueToNumber(value: FrameCell, type: FrameColType): number | null {
  if (type === "logical") {
    const b = coerceLogical(value);
    return b === null ? null : b ? 1 : 0;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The three predicates that read cells AS TEXT. */
export const TEXT_FILTER_OPS: ReadonlySet<FilterOp> = new Set(["contains", "startsWith", "endsWith"]);

const TEXT_OP_LABEL: Record<string, string> = {
  contains: "Contains", startsWith: "Starts with", endsWith: "Ends with",
};

/** A text predicate on a non-text column is a CONFIGURATION error, `#TYPE!` — never a
 *  stringified comparison (rules textPredicateNeedsText, author verdict 2026-08-30).
 *  The old `String(cell)` fallback forced the Rust engine to mirror JS number printing
 *  digit-for-digit forever (`js_number_string`, deleted with this rule). */
export function requireTextColumn(op: FilterOp, type: FrameColType, column: string): void {
  if (!TEXT_FILTER_OPS.has(op) || type === "string") return;
  throw solError(
    "#TYPE!",
    `${TEXT_OP_LABEL[op] ?? op} reads text — "${column}" is a ${type} column. ` +
    `Convert it first: a Computed Column like TEXT(@${column}, "@"), or Cast to Text`,
  );
}

/** The list twin of `requireTextColumn` (same rule, no column to name). */
export function requireTextList(op: FilterOp, type: FrameColType): void {
  if (!TEXT_FILTER_OPS.has(op) || type === "string") return;
  throw solError(
    "#TYPE!",
    `${TEXT_OP_LABEL[op] ?? op} reads text — this is a ${type} list. Cast it to Text first`,
  );
}

export function passesFilter(cell: FrameCell, op: FilterOp, value: FrameCell, type: FrameColType, matchCase: boolean): boolean {
  // These run BEFORE the null/error guard below, since they exist to SELECT on those
  // states; `noterror` keeps a null — pair it with `notblank` to drop both.
  if (op === "iserror")  return isSolError(cell);
  if (op === "noterror") return !isSolError(cell);
  // An error cell is present, not blank: isblank false, notblank true.
  if (op === "isblank")  return cell === null;
  if (op === "notblank") return cell !== null;
  if (cell === null || isSolError(cell)) return false;
  // A null comparison VALUE matches no rows — the text path would otherwise stringify
  // it to the literal "null".
  if (value === null) return false;
  // Simple lowercase fold, NOT locale-aware — the one spec both engines
  // implement identically (Rust `to_lowercase()` agrees with JS `toLowerCase()`).
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

/** Keep rows whose `column` passes the predicate. Chain filters for AND (the
 *  SUMIFS pattern); blanks/errors are dropped. */
export function filterRows(f: FrameValue, column: string, op: FilterOp, value: FrameCell, matchCase = false): FrameValue {
  const col = requireColumn(f, column);
  requireTextColumn(op, col.type, column);
  const keep: number[] = [];
  for (let i = 0; i < frameRowCount(f); i++) {
    if (passesFilter(cellAt(col, i), op, value, col.type, matchCase)) keep.push(i);
  }
  return reorderRows(f, keep);
}

/** Keep rows passing ALL ("and") or ANY ("or") of the conditions — SQL WHERE
 *  made visual (B-2). Each condition applies `passesFilter` independently
 *  (blanks/errors fail THAT condition; an unparseable value matches no rows for
 *  that condition — under OR the others still can). No conditions = identity
 *  on BOTH engines (not OR's vacuous-false), so a blank node passes data through. */
export function filterRowsMulti(f: FrameValue, combine: FilterCombine, conditions: readonly FilterCond[], complement = false): FrameValue {
  // `complement` is the ROW complement, not predicate negation: Kept ∪ Dropped = every
  // row, so a null/error cell that fails its condition is KEPT here.
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

/** Most-frequent finite number; ties broken by first occurrence (Excel MODE.SNGL). */
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

/** Variance — `sample` divides by n−1 (VAR.S / STDEV.S), else by n (VAR.P /
 *  STDEV.P). Returns null when undefined (sample needs ≥2 points). */
function varianceOf(nums: readonly number[], sample: boolean): number | null {
  const n = nums.length;
  if (sample && n < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const ss = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return ss / (sample ? n - 1 : n);
}

/** Aggregate one group's cells. count = present (non-null) cells; the numeric ops
 *  run through forAggregate (a per-cell error PROPAGATES, null is SKIPPED). An
 *  empty group is 0 for sum, 1 for product, else `null` (missing). `percentof` is
 *  resolved by the pivot (needs a total set) — null here. Exported: Cube Rollup
 *  (cube.ts) reuses this same aggregator over a nested sub-frame's column, so a
 *  cube-costing roll-up and a Group By agree on every op's edge cases. */
export function aggregateGroup(values: FrameCell[], op: AggOp): FrameCell {
  if (op === "count") return values.filter((v) => v !== null).length;
  if (op === "percentof") return null;
  // Logical cells aggregate as 1/0 (SUM over a logical column = count of TRUEs).
  const prep = forAggregate(values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
  if (prep.error) return prep.error;
  // ±Inf/NaN are REAL inputs; a NaN poisons up front because reduce-order NaN
  // comparisons are not deterministic.
  const nums = prep.nums;
  if (nums.length === 0) return op === "sum" ? 0 : op === "product" ? 1 : null;
  if (nums.some((n) => Number.isNaN(n))) return guardFinite(NaN, ...nums);
  const r = rawAggregate(nums, op);
  // The WIRE path carries op as a free string, and a bad op NAME is a request error —
  // refuse the whole verb rather than seed per-cell errors.
  if (r === undefined) throw solError("#NAME?", `Unknown aggregation "${op}"`);
  return guardAgg(r, nums);
}

function guardAgg(r: number | null, inputs: readonly number[]): FrameCell {
  return typeof r === "number" ? guardFinite(r, ...inputs) : r;
}

function rawAggregate(nums: readonly number[], op: Exclude<AggOp, "count" | "percentof">): number | null {
  switch (op) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return nums.reduce((a, b) => (b < a ? b : a)); // reduce, not Math.min(...spread) (large-group RangeError)
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

/** SUM of a group's finite cells (the numerator/denominator of PERCENTOF). A
 *  per-cell error propagates; an empty/all-null set is 0. */
function sumGroup(values: FrameCell[]): FrameCell {
  const prep = forAggregate(values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
  if (prep.error) return prep.error;
  return prep.nums.filter((n) => Number.isFinite(n)).reduce((a, b) => a + b, 0);
}

/** GROUP BY: one output row per unique combination of `keys` (first-seen order),
 *  carrying the key columns plus each aggregation as its own `as`-named numeric
 *  column. Generalizes the 1-D GroupByNode to a frame with multi-key + multi-agg. */
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
    name: c.name, type: c.type,
    values: keyOrder.map((k) => cellAt(c, buckets.get(k)![0])), // every row in a bucket shares the key
  }));
  const aggOut: FrameColumn[] = aggCols.map(({ spec, col }) => {
    const preserves = spec.op === "min" || spec.op === "max";
    // The non-finite guard lives INSIDE aggregateGroup so pivot's re-aggregating
    // totals get it too — not just this verb.
    let values = keyOrder.map((k) => aggregateGroup(buckets.get(k)!.map((i) => cellAt(col, i)), spec.op));
    // aggregateGroup coerces logicals to numbers on the way in, and a logical-typed
    // column must not carry number cells.
    if (preserves && col.type === "logical") {
      values = values.map((v) => (typeof v === "number" ? v !== 0 : v));
    }
    return {
      name: spec.as,
      // min/max preserve the SOURCE type (a min over a date column IS a date,
      // not a bare serial); sum/avg/count are always numeric.
      type: preserves ? col.type : "number",
      values,
    };
  });
  // De-dupe output names ("count of Region grouped by Region" collides the agg
  // `as` with the key).
  const out = [...keyOut, ...aggOut];
  const unique = makeHeaders(out.map((c) => c.name), out.length);
  out.forEach((c, i) => { c.name = unique[i]; });
  return frame(out);
}

/** Keep exactly `names`, in the given order. A missing name is a #REF!. */
export function selectColumns(f: FrameValue, names: readonly string[]): FrameValue {
  // Dedupe repeats, keeping the first — a duplicate selection is a hard Polars
  // error on desktop.
  const seen = new Set<string>();
  const wanted = names.filter((n) => !seen.has(n) && (seen.add(n), true));
  return frame(wanted.map((n) => requireColumn(f, n)));
}

/** Remove `names` (a name not present is silently ignored — "drop if there"). */
export function dropColumns(f: FrameValue, names: readonly string[]): FrameValue {
  const remove = new Set(names);
  return frame(f.columns.filter((c) => !remove.has(c.name)));
}

/** Rename via an old→new map; columns not in the map keep their name. Renames
 *  that collide are de-duplicated left-to-right (Date,Name→Date,Date2 etc.),
 *  same rule as header construction, so the result always has unique names. */
export function renameColumns(f: FrameValue, map: Record<string, string>): FrameValue {
  const proposed = f.columns.map((c) => (map[c.name] ?? c.name));
  const unique = makeHeaders(proposed, proposed.length);
  return frame(f.columns.map((c, i) => ({ ...c, name: unique[i] })));
}

/** SPLIT COLUMN (Power Query "Split Column by Delimiter"): split one text column
 *  by `delimiter` into N columns (N = the max part count across rows; short rows pad
 *  `null`). The source column is REPLACED in place by the new columns. Names come
 *  from `names` (padded/truncated to N) else "<col> 1".."<col> N"; parts are text.
 *  A `null`/error source cell yields all-`null` parts. Empty delimiter ⇒ no-op. */
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

/** ADD INDEX (Power Query "Add Index Column"): prepend a numeric row-number column
 *  counting from `start` (step 1). Name de-duped against the existing columns. */
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
// backward = latest right key ≤ left key (Polars' default strategy); forward =
// earliest right key ≥ left key; nearest = whichever is closer (ties → backward).
export type AsofDirection = "backward" | "forward" | "nearest";
export interface JoinOpts {
  leftKey: string; rightKey: string; how: JoinHow;
  asofDirection?: AsofDirection; // only read when how === "asof"; default "backward"
  asofTolerance?: number;        // max |left-right| key distance; unset = unlimited
}

const encKey = (v: FrameCell): string => JSON.stringify(encodeCell(v));

/** A `null` or error key is NOT indexed, so it never matches (Polars' join_nulls=False);
 *  an unmatched null-key row still flows through left/right/outer. */
function keyIndex(col: FrameColumn, n: number): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const cell = cellAt(col, i);
    // NON-FINITE keys never join, even now that they key apart for dedupe: NaN
    // does not equal itself, and ±∞ are overflow sentinels — two rows that both
    // overflowed are not the same entity. verb_join masks them to null likewise.
    if (cell === null || isSolError(cell) || (typeof cell === "number" && !Number.isFinite(cell))) continue;
    const k = encKey(cell);
    const bucket = idx.get(k);
    if (bucket) bucket.push(i); else idx.set(k, [i]);
  }
  return idx;
}

/** Shared by every `how` (asof included) — they differ only in how `pairs` is
 *  resolved. Layout: LEFT columns (key coalesced) + RIGHT non-key, names de-duped. */
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
      name: names[ci], type: c.type,
      values: pairs.map(([l, r]) =>
        isKey
          ? (l !== null ? cellAt(c, l) : r !== null ? cellAt(rk, r) : null) // coalesce key from present side
          : (l !== null ? cellAt(c, l) : null)),
    });
  });
  rightNonKey.forEach((c, ri) => {
    out.push({
      name: names[left.columns.length + ri], type: c.type,
      values: pairs.map(([, r]) => (r !== null ? cellAt(c, r) : null)),
    });
  });
  return frame(out);
}

function isOrderableKey(type: FrameColType): boolean {
  return type === "number" || type === "date";
}

/** Binary-search `sortedRight` (ascending by key, ties in original-index order)
 *  for the row that asof-matches `key` under `direction`; returns its original
 *  row index, or `null` when there's no candidate or it's beyond `tolerance`. */
function asofNearest(
  sortedRight: readonly { key: number; idx: number }[], key: number,
  direction: AsofDirection, tolerance: number | undefined,
): number | null {
  const n = sortedRight.length;
  if (n === 0) return null;
  // upperBound = first index with key > target; backward candidate = upperBound-1
  // (the LAST entry with key ≤ target, correct even with duplicate keys).
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedRight[mid].key <= key) lo = mid + 1; else hi = mid; }
  const backward = lo - 1;
  // lowerBound = first index with key >= target = the forward candidate.
  let lo2 = 0, hi2 = n;
  while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (sortedRight[mid].key < key) lo2 = mid + 1; else hi2 = mid; }
  const forward = lo2 < n ? lo2 : -1;

  let pick: number;
  if (direction === "backward") pick = backward;
  else if (direction === "forward") pick = forward;
  else if (backward === -1) pick = forward; // nearest, only one side available
  else if (forward === -1) pick = backward;
  else {
    const db = key - sortedRight[backward].key, df = sortedRight[forward].key - key;
    pick = df < db ? forward : backward; // tie → backward
  }
  if (pick === -1) return null;
  if (tolerance !== undefined && Math.abs(sortedRight[pick].key - key) > tolerance) return null;
  return sortedRight[pick].idx;
}

/** Left-driving and never fans out: each LEFT row keeps its original position and takes
 *  the nearest RIGHT row. Needs an orderable (number/date) key; null/error keys never
 *  match, as in an equality join. */
function asofPairs(
  left: FrameValue, lk: FrameColumn, right: FrameValue, rk: FrameColumn, opts: JoinOpts,
): [number | null, number | null][] {
  if (!isOrderableKey(lk.type) || !isOrderableKey(rk.type)) {
    throw solError("#VALUE!", "As-of join requires a numeric or date key");
  }
  const rn = frameRowCount(right);
  // A non-finite key never matches, same as a null key — the Polars kernel drops
  // it too.
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

/** Join two frames on a key. Output = LEFT columns (key coalesced from whichever
 *  side is present) + RIGHT non-key columns, colliding names de-duped. A left row
 *  matching several right rows FANS OUT to several output rows. inner = matches
 *  only; left/right keep all rows of that side (other side null); outer keeps all
 *  of both; asof = nearest-match (see `asofPairs`). The unmatched side's cells
 *  are `null`. */
/** Cartesian product, left-major: every left row paired with every right row; ALL
 *  columns of both sides, colliding names deduped (pandas merge(how="cross"), R
 *  expand.grid / tidyr crossing, SQL CROSS JOIN). No keys. */
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
  if (opts.how === "cross") return crossJoinFrames(left, right);
  const lk = requireColumn(left, opts.leftKey);
  const rk = requireColumn(right, opts.rightKey);
  // Keys of two different types can never match (families never auto-cross) —
  // refuse loudly rather than return a silent empty result. Cast a key first.
  if (lk.type !== rk.type) {
    throw solError("#TYPE!", `Join keys must share a type ("${lk.type}" vs "${rk.type}")`);
  }
  const ln = frameRowCount(left), rn = frameRowCount(right);

  // Semi/anti FILTER the left frame (the table-level set intersect/difference):
  // keep left rows whose key does / doesn't match in right — original order, no
  // fan-out, LEFT columns only (Polars' semi/anti layout). A null/error key never
  // matches (same rule as the equality joins), so it's dropped by semi, kept by anti.
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
// The PVM decomposition is the standard three-term FP&A one; price + volume + mix
// sums EXACTLY to P1·Q1 − P0·Q0 (the total delta).
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
  /** Matched/present rows dropped from the decomposition because a present price or
   *  qty cell was errored or non-numeric (can't attribute a swing to price vs volume
   *  when a factor is unknown). `delta` = price+volume+mix over the INCLUDED rows only. */
  excluded: number;
}
export interface ReconcileSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** Rows with a blank (null) or errored KEY — they can't be matched, so they're
   *  emitted as their own "skipped" rows rather than silently dropped. */
  skipped: number;
  /** Non-key columns present on only ONE side. They do NOT drive row status — a
   *  one-sided column applies to every matched row equally — so they surface here. */
  addedColumns: string[];
  removedColumns: string[];
  pvm?: PvmBreakdown;
}

function cellsEqual(a: FrameCell, b: FrameCell): boolean {
  if (a === null && b === null) return true;
  if (isSolError(a) || isSolError(b)) return false; // an error cell is never "unchanged"
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

  // The schema diff: a removed column carries its before-values (null after); an
  // added one its after-values (null before), aligned to the output rows via li/ri.
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

  // PVM is NOT computed here — the match loop handles it inline.
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

  // A PVM factor is genuinely 0 when the row is ABSENT on that side (a new/removed row
  // truly had 0 before/after), but UNKNOWN (→ null) when the cell is PRESENT yet errored
  // or non-numeric — those rows are excluded from the decomposition.
  const pvmFactor = (present: boolean, raw: FrameCell): number | null =>
    !present ? 0 : (typeof raw === "number" ? raw : null);

  let added = 0, removed = 0, changed = 0, unchanged = 0, skipped = 0;
  let totalBefore = 0, totalAfter = 0, pvmPrice = 0, pvmVolume = 0, pvmMix = 0, pvmExcluded = 0;

  for (const k of allKeys) {
    const lRows = lIdx.get(k) ?? [];
    const rRows = rIdx.get(k) ?? [];
    // A duplicate key on either side pairs up positionally; extra rows on the
    // longer side are their own added/removed rows — the row total stays exact.
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
      pushRow(li !== null ? cellAt(lk, li) : cellAt(rk, ri!), status, li, ri);

      if (havePvm) {
        const p0 = pvmFactor(li !== null, li !== null ? cellAt(sharedCols[priceIdx].left, li) : null);
        const p1 = pvmFactor(ri !== null, ri !== null ? cellAt(sharedCols[priceIdx].right, ri) : null);
        const q0 = pvmFactor(li !== null, li !== null ? cellAt(sharedCols[qtyIdx].left, li) : null);
        const q1 = pvmFactor(ri !== null, ri !== null ? cellAt(sharedCols[qtyIdx].right, ri) : null);
        if (p0 === null || p1 === null || q0 === null || q1 === null) {
          pvmExcluded++; // a present price/qty cell was errored or missing — undecomposable
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

  // A blank/errored KEY never entered `allKeys`, so it is appended as its own "skipped"
  // row and tallied — the row total must stay exact.
  for (let i = 0; i < ln; i++) {
    const kc = cellAt(lk, i);
    if (kc === null || isSolError(kc)) { pushRow(kc, "skipped", i, null); skipped++; }
  }
  for (let i = 0; i < rn; i++) {
    const kc = cellAt(rk, i);
    if (kc === null || isSolError(kc)) { pushRow(kc, "skipped", null, i); skipped++; }
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
/** UNPIVOT (melt): wide → long. Keeps `idColumns`; turns each of `valueColumns`
 *  into rows of (variable = that column's name, value = the cell). Output =
 *  idColumns + a `variableName` (default "variable") + a `valueName` (default
 *  "value") column. The value column's type is the first value column's type
 *  (cells ride as-is if value columns mix types). */
export function unpivotFrame(
  f: FrameValue, idColumns: readonly string[], valueColumns: readonly string[],
  opts?: { variableName?: string; valueName?: string },
): FrameValue {
  const idCols = idColumns.map((n) => requireColumn(f, n));
  const valCols = valueColumns.map((n) => requireColumn(f, n));
  // The melted `value` column is ONE typed column, and mixed types silently null on the
  // engine side — reject on mismatch, as append's union rule does.
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
  return frame([
    ...idCols.map((c, k) => ({ name: names[k], type: c.type, values: idVals[k] })),
    { name: names[idCols.length], type: "string" as const, values: varVals },
    { name: names[idCols.length + 1], type: valCols[0]?.type ?? "number", values: valVals },
  ]);
}

/** PIVOTBY: long → wide cross-tab, matching Excel's `=PIVOTBY`. Group rows by one
 *  or more `rowFields` (multi-level row headers) and columns by one or more
 *  `colFields` (multi-level column headers); each body cell aggregates a value
 *  column over the source rows at that (rowGroup, colGroup) with that value's
 *  function (`funcs`, parallel to `values`). Multiple value columns fan the body
 *  out (one body column per colGroup × value).
 *
 *  Totals live HERE — `rowTotalDepth`/`colTotalDepth` (0 none · 1 grand · 2
 *  grand+subtotals · negative ⇒ placed at top/left) add total rows/columns that
 *  RE-AGGREGATE the underlying source (a grand AVERAGE is the average of all source
 *  rows, NOT the average of the displayed cell averages). Subtotals need ≥2 fields
 *  on that axis; depth d shows the outermost (|d|−1) subtotal levels.
 *
 *  `rowSort`/`colSort` = a signed 1-based index into [fields…, values…] (negative ⇒
 *  descending): a field index orders that header level; a value index orders groups
 *  by that value's grand total (Excel's "sort by sales"). `filter` masks source
 *  rows. `percentof` values divide SUM(cell)/SUM(totalset), the total set chosen by
 *  `relativeTo` (0 col · 1 row · 2 grand · 3 parent-col · 4 parent-row). */
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

/** Distinct leaf tuples of `cols` over `rows`, ordered hierarchically so each outer
 *  group stays contiguous (first-seen rank per level). `sortField` (0-based, valid
 *  only when < cols.length) re-orders that level by value; `desc` reverses it. No
 *  fields → one anonymous group `[[]]`. */
function orderLeaves(rows: readonly number[], cols: readonly FrameColumn[], sortField: number, desc: boolean): FrameCell[][] {
  if (cols.length === 0) return [[]];
  const tuples = new Map<string, FrameCell[]>();
  const firstSeen: string[] = [];
  for (const i of rows) {
    const k = leafKeyOf(cols, i);
    if (!tuples.has(k)) { tuples.set(k, cols.map((c) => cellAt(c, i))); firstSeen.push(k); }
  }
  const levelRank: Map<string, number>[] = cols.map(() => new Map());
  const cellByEnc: Map<string, FrameCell>[] = cols.map(() => new Map());
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

/** One output slot on an axis: which leaf indices it spans + how to label it.
 *  kind 'leaf' = a real group; 'sub' = a subtotal over a prefix; 'grand' = all. */
interface AxisOut { kind: "leaf" | "sub" | "grand"; span: number[]; tuple: FrameCell[]; fill: number; }

/** Expand ordered leaves into leaves + subtotal + grand slots, honoring a signed
 *  `depth` (1 grand · 2 grand+sub · negative ⇒ totals at top). `nFields` gates
 *  subtotals (need ≥2). Subtotal levels = outermost (|depth|−1), nested. */
function expandAxis(leaves: FrameCell[][], depth: number, nFields: number): AxisOut[] {
  const out: AxisOut[] = leaves.map((t, i) => ({ kind: "leaf" as const, span: [i], tuple: t, fill: nFields }));
  if (depth === 0 || nFields === 0) return out;
  const top = depth < 0;
  const subLevels = Math.min(Math.abs(depth) - 1, Math.max(0, nFields - 1));
  // Subtotals: for each prefix length p in [1..subLevels], one slot per distinct prefix run.
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
  // Interleave subtotals at each run boundary: BELOW its group (anchored to the
  // run's last leaf, inner-first) by default, or ABOVE it (anchored to the run's
  // first leaf, outer-first) when totals are placed at top.
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
  // A sort index in [1..nFields] orders that header level inside orderLeaves; an
  // index past the fields refers to a value column (Excel's "sort by sales") and is
  // applied as a reorder of whole groups by that value's grand total, below.
  let rowLeaves = orderLeaves(rows, rowCols, Math.abs(rs) - 1 < rowCols.length ? Math.abs(rs) - 1 : -1, rs < 0);
  let colLeaves = orderLeaves(rows, colCols, Math.abs(cs) - 1 < colCols.length ? Math.abs(cs) - 1 : -1, cs < 0);
  const R = rowLeaves.length, C = colLeaves.length, V = valCols.length;
  const rowKeyIndex = new Map(rowLeaves.map((t, i) => [tupleKey(t), i]));
  const colKeyIndex = new Map(colLeaves.map((t, i) => [tupleKey(t), i]));

  // cells[v][r][c] = the source value cells at that (rowGroup, colGroup).
  const cells: FrameCell[][][][] = valCols.map(() =>
    Array.from({ length: R }, () => Array.from({ length: C }, () => [] as FrameCell[])));
  for (const i of rows) {
    const r = rowKeyIndex.get(leafKeyOf(rowCols, i)), c = colKeyIndex.get(leafKeyOf(colCols, i));
    if (r === undefined || c === undefined) continue;
    valCols.forEach((vc, v) => cells[v][r][c].push(cellAt(vc, i)));
  }

  // Reorders whole groups by a value column's grand total (Excel's "sort by Sales");
  // stable, NaN/error last, and it reorders leaves flatly, so single-level axes only.
  const aggNum = (cellsList: FrameCell[], op: AggOp): number => {
    const a = aggregateGroup(cellsList, op === "percentof" ? "sum" : op);
    return typeof a === "number" ? a : NaN;
  };
  const rowValSort = Math.abs(rs) - 1 - rowCols.length;
  if (rowValSort >= 0 && rowValSort < V && R > 1) {
    const score = (r: number) => aggNum(Array.from({ length: C }, (_, c) => cells[rowValSort][r][c]).flat(), funcs[rowValSort]);
    const perm = rowLeaves.map((_, r) => r).sort((x, y) => {
      const sx = score(x), sy = score(y);
      if (Number.isNaN(sx) || Number.isNaN(sy)) return Number.isNaN(sx) ? (Number.isNaN(sy) ? 0 : 1) : -1;
      return rs < 0 ? sy - sx : sx - sy;
    });
    rowLeaves = perm.map((r) => rowLeaves[r]);
    for (let v = 0; v < V; v++) cells[v] = perm.map((r) => cells[v][r]);
  }
  const colValSort = Math.abs(cs) - 1 - colCols.length;
  if (colValSort >= 0 && colValSort < V && C > 1) {
    const score = (c: number) => aggNum(Array.from({ length: R }, (_, r) => cells[colValSort][r][c]).flat(), funcs[colValSort]);
    const perm = colLeaves.map((_, c) => c).sort((x, y) => {
      const sx = score(x), sy = score(y);
      if (Number.isNaN(sx) || Number.isNaN(sy)) return Number.isNaN(sx) ? (Number.isNaN(sy) ? 0 : 1) : -1;
      return cs < 0 ? sy - sx : sx - sy;
    });
    colLeaves = perm.map((c) => colLeaves[c]);
    for (let v = 0; v < V; v++) for (let r = 0; r < R; r++) cells[v][r] = perm.map((c) => cells[v][r][c]);
  }
  const collect = (v: number, rset: readonly number[], cset: readonly number[]): FrameCell[] => {
    const acc: FrameCell[] = [];
    for (const r of rset) for (const c of cset) acc.push(...cells[v][r][c]);
    return acc;
  };
  const allRows = rowLeaves.map((_, i) => i), allCols = colLeaves.map((_, i) => i);
  // Parent (one level up) groups for relativeTo 3/4 — leaves sharing the prefix.
  const parentOf = (leaves: FrameCell[][], idx: number): number[] => {
    const t = leaves[idx]; if (t.length <= 1) return leaves.map((_, i) => i);
    const pk = tupleKey(t.slice(0, t.length - 1));
    return leaves.map((lt, i) => (tupleKey(lt.slice(0, lt.length - 1)) === pk ? i : -1)).filter((i) => i >= 0);
  };

  /** A body/total cell for value v spanning rset×cset. percentof divides
   *  SUM(cell)/SUM(totalset), the total set chosen by relativeTo. */
  const cellValue = (v: number, rset: number[], cset: number[]): FrameCell => {
    const here = collect(v, rset, cset);
    if (here.length === 0) return null; // an absent (row, column) combination is blank
    if (funcs[v] !== "percentof") return aggregateGroup(here, funcs[v]);
    const num = sumGroup(here);
    if (isSolError(num)) return num;
    let dr = rset, dc = cset;
    if (relativeTo === 0) dr = allRows;                                    // column total
    else if (relativeTo === 1) dc = allCols;                               // row total
    else if (relativeTo === 2) { dr = allRows; dc = allCols; }             // grand total
    else if (relativeTo === 3) dc = cset.length === 1 ? parentOf(colLeaves, cset[0]) : allCols; // parent col
    else if (relativeTo === 4) dr = rset.length === 1 ? parentOf(rowLeaves, rset[0]) : allRows; // parent row
    const den = sumGroup(collect(v, dr, dc));
    if (isSolError(den)) return den;
    return (den as number) === 0 ? null : (num as number) / (den as number);
  };

  const rowOut = expandAxis(rowLeaves, spec.rowTotalDepth ?? 0, rowCols.length);
  const colOut = expandAxis(colLeaves, spec.colTotalDepth ?? 0, colCols.length);

  // ── Key columns (one per rowField). Subtotal rows fill the prefix + a "Total"
  //    marker in the next column; the grand row is "Grand Total" in column 0. ──
  const keyNames = makeHeaders(rowFields, rowFields.length);
  const keyColumns: FrameColumn[] = rowCols.map((c, k) => ({
    name: keyNames[k], type: c.type,
    values: rowOut.map((ro) => {
      if (ro.kind === "grand") return k === 0 ? "Grand Total" : null;
      if (ro.kind === "sub")   return k < ro.fill ? ro.tuple[k] : k === ro.fill ? "Total" : null;
      return ro.tuple[k];
    }),
  }));

  // ── Body columns: colSlot × value. Header = colTuple joined " | " (+ value name
  //    when >1 value), collapsing to the plain Excel layout for the simple case. ──
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
  const bodyColumns: FrameColumn[] = bodySpecs.map(({ co, v }, bi) => ({
    name: bodyNames[bi], type: "number",
    values: rowOut.map((ro) => cellValue(v, ro.span, co.span)),
  }));

  return frame([...keyColumns, ...bodyColumns]);
}

// ─── Nest / Unnest (the flat ⟷ cube bridge) ───────────────────────────────────
const cubeCellAt = (col: CubeColumn, i: number): CubeCell => (i < col.cells.length ? col.cells[i] : null);

/** NEST: group ONE flat frame by `keyColumns` into a Cube — one parent row per
 *  distinct key (first-seen), the NON-key columns collapsed into a nested-frame
 *  cell per group. The standalone sibling of Nest Join (which nests a SECOND
 *  frame); here the child rows come from the same frame. Inverse of unnest. */
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
    // Carry the frame column's type (typed CubeColumn) so a date key stays
    // date-matchable in a cube XLOOKUP.
    name: names[k], type: c.type, cells: order.map((key) => cellAt(c, buckets.get(key)![0])),
  }));
  const nestedCells: CubeCell[] = order.map((key) => {
    const rowIdx = buckets.get(key)!;
    return {
      __frame: true,
      columns: childCols.map((c) => ({
        name: c.name, type: c.type, ...(c.unit ? { unit: c.unit } : {}),
        values: rowIdx.map((i) => cellAt(c, i)),
      })),
    } as FrameValue;
  });
  return cubeFromColumns([...keyOut, { name: names[keyColumns.length], cells: nestedCells }]);
}

/** UNNEST: peel a Cube's nested column ONE level — each parent row repeats once per
 *  child row, with the child's columns appended. Nested FRAMES flatten to a flat Frame;
 *  nested CUBES peel to a shallower Cube (a child's own nested column stays nested). A
 *  column mixing frames and cubes is a `#TYPE!`. Parent rows whose nested value is
 *  empty/missing are dropped (standard unnest). Parent (flat) column types are re-inferred
 *  on the frame path; nested column types are preserved. */
export function unnestCube(c: CubeValue, nestedColumn: string): FrameValue | CubeValue {
  const nestedIdx = c.columns.findIndex((col) => col.name === nestedColumn);
  if (nestedIdx < 0) throw solError("#REF!", `column "${nestedColumn}" not found`);
  const flatCols = c.columns.filter((_, j) => j !== nestedIdx);
  const nested = c.columns[nestedIdx];

  // The child kind decides the output rank: all frames → flat Frame; all cubes → peel one
  // level to a shallower Cube; a mix is unresolvable.
  let sawFrame = false, sawCube = false;
  for (const cell of nested.cells) {
    if (isFrameValue(cell)) sawFrame = true;
    else if (isCubeValue(cell)) sawCube = true;
  }
  if (sawFrame && sawCube) throw solError("#TYPE!", "nested cells must all be tables or all be cubes");

  if (sawCube) {
    // ── PEEL: nested cells are cubes → a depth-(n−1) cube. ──
    const schemaCube = nested.cells.find((cell) => isCubeValue(cell)) as CubeValue | undefined;
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

  // ── FLATTEN: nested cells are frames (or none) → the flat-frame path. ──
  const schemaFrame = nested.cells.find((cell) => isFrameValue(cell)) as FrameValue | undefined;
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
/** Does a key cell equal the typed-in `lookup` text, by the key column's type?
 *  string → case-INSENSITIVE text (Excel's default lookup match — "Apple" finds
 *  "apple"); logical → 0/1 identity (so "1"/"true" both match
 *  TRUE); date → the lookup parsed as a serial (digits) or an ISO date;
 *  number → numeric. */
// The node's lookup arrives as a STRING (its lookup socket is string-typed — the
// Expression-node socket guard is what keeps frames off the formula surface, not a
// separate impl). Parse it into a needle typed by the key column, then hand the actual
// MATCH to the shared `xmatchIndex` — the SAME kernel the XMATCH/XLOOKUP formulas use,
// so the node and formula surfaces cannot drift. This parse is the node's only extra
// step; the formula's caller already holds a typed value.
function lookupNeedle(lookup: string, type: FrameColType): FrameCell {
  if (type === "logical") return !!coerceLogical(lookup);
  if (type === "date") {
    const t = lookup.trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : parseDateToSerial(t);
  }
  if (type === "number") return Number(lookup);
  return lookup; // string — lookupEq folds case
}

const NODE_TO_XMATCH_MODE: Record<LookupMatchMode, XMatchMatchMode> = {
  exact: "exact", nextSmaller: "next_smaller", nextLarger: "next_larger",
};

/** XLOOKUP's `match_mode`: "exact" (default) requires an equal cell; "nextSmaller"/
 *  "nextLarger" fall back to the closest ≤/≥ row ONLY when no exact match exists
 *  (Excel's match_mode -1/1) — an exact hit always wins first. Approximate modes
 *  require an orderable (number/date) key column. */
export type LookupMatchMode = "exact" | "nextSmaller" | "nextLarger";

/** XLOOKUP's `search_mode`: which end to scan from — so which row wins when the
 *  key column has DUPLICATES. "first" (default, Excel's search_mode 1) returns the
 *  first match top-to-bottom; "last" (search_mode -1) returns the last. Affects
 *  exact matching; an approximate (≤/≥) match already picks the closest key. */
export type LookupSearchMode = "first" | "last";

/** A cube's top-level column by name, or a #REF! (thrown; the caller's guard
 *  renders it). Mirrors `requireColumn` for frames. */
function requireCubeColumn(c: CubeValue, name: string): CubeColumn {
  const col = c.columns.find((k) => k.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  return col;
}

/** FALLBACK for a hand-built cube column with no carried `type`: all-number → number,
 *  all-boolean → logical, else string. NEVER "date" by inference — a date and a plain
 *  number are indistinguishable as serials, so an untyped date column matches
 *  numerically. Containers/null/error cells are ignored. */
function inferCubeKeyType(col: CubeColumn): FrameColType {
  let sawNumber = false, sawBool = false, sawOther = false;
  for (const cell of col.cells) {
    if (cell === null || isSolError(cell)) continue;
    if (typeof cell === "number") sawNumber = true;
    else if (typeof cell === "boolean") sawBool = true;
    else sawOther = true; // string, or a nested frame/cube/list (won't match anyway)
  }
  if (sawOther || (sawNumber && sawBool)) return "string";
  if (sawNumber) return "number";
  if (sawBool) return "logical";
  return "string"; // empty / all-null column
}

/** THE XLOOKUP cell-getter (frame + cube). A frame is looked up by `frameToCube` first
 *  (it carries `col.type`), so this one path serves both surfaces. Matches TOP-LEVEL
 *  columns only — never descends into nested cells — and returns the matched cell WHOLE,
 *  so a nested frame/cube comes out intact. `undefined` on no match, #REF! on a missing
 *  column; null/error/container key cells never match. */
export function lookupCell(
  c: CubeValue, lookupColumn: string, returnColumn: string, lookup: string,
  matchMode: LookupMatchMode = "exact", searchMode: LookupSearchMode = "first",
): CubeCell | undefined {
  const idx = lookupRowIndex(c, lookupColumn, lookup, matchMode, searchMode);
  const ret = requireCubeColumn(c, returnColumn); // #REF! if the return column is missing
  if (idx < 0) return undefined;
  return idx < ret.cells.length ? ret.cells[idx] ?? null : null;
}

/** THE XLOOKUP row-finder (frame + cube) — shared by the cell return and the whole-row
 *  `*` return (`frameRowAt` / `cubeRowAt`). Returns the matched 0-based row index, or -1.
 *  Only the KEY column is required (#REF! if missing). A null / error / nested-container
 *  key cell is never a key (first-match-wins + join-key rules). */
export function lookupRowIndex(
  c: CubeValue, lookupColumn: string, lookup: string,
  matchMode: LookupMatchMode = "exact", searchMode: LookupSearchMode = "first",
): number {
  const key = requireCubeColumn(c, lookupColumn);
  // Prefer the column's CARRIED type so a date-keyed column matches an ISO-date lookup
  // (a frame column and a frame→cube column both carry it); fall back to inference only
  // for a hand-built (untyped) cube.
  const keyType = key.type ?? inferCubeKeyType(key);
  if (matchMode !== "exact" && !isOrderableKey(keyType)) {
    throw solError("#VALUE!", "Approximate lookup requires a numeric or date column");
  }
  const needle = lookupNeedle(lookup, keyType);
  if (matchMode !== "exact" && !(typeof needle === "number" && Number.isFinite(needle))) return -1;
  // A nested frame/cube/list key cell is never `===` a scalar and never numeric, so
  // xmatchIndex excludes it as a key on its own.
  const keys = key.cells.slice(0, cubeRowCount(c));
  const idx = xmatchIndex(needle, keys, NODE_TO_XMATCH_MODE[matchMode], searchMode);
  return isSolError(idx) ? -1 : idx;
}

/** XLOOKUP's whole-row return (`Return = *`): the matched row as a single-row Frame
 *  (derived, so `raw` source text is dropped — same as any reordered frame). */
export function frameRowAt(f: FrameValue, i: number): FrameValue {
  return reorderRows(f, [i]);
}

/** The cube whole-row return: the matched row as a single-row Cube, each top-level
 *  column keeping its one cell WHOLE (a nested frame/cube stays intact). */
export function cubeRowAt(c: CubeValue, i: number): CubeValue {
  return cubeFromColumns(
    c.columns.map((col) => ({ name: col.name, type: col.type, cells: [i < col.cells.length ? col.cells[i] ?? null : null] })),
  );
}

// Normalize the XLookup node's polymorphic Table/Cube source to a Frame or Cube. Its socket
// is `cube` and the value arrives un-widened (noWidenInputs), and the node's shape guard has
// already rejected a scalar / bare 1-D — so in practice a Frame/Cube passes through and a
// matrix widens into a Frame; the scalar/list arms below stay as defensive fallbacks.
export function asLookupSource(v: unknown): FrameValue | CubeValue | null {
  if (v == null) return null;
  if (isCubeValue(v)) return v;
  if (isFrameValue(v)) return v;
  if (Array.isArray(v)) return Array.isArray(v[0]) ? frameFromRows(v as unknown[][]) : frameFromRows([v as unknown[]]);
  return frameFromRows([[v]]);
}

// ─── Append / Union (n-ary) ────────────────────────────────────────────────────
/** Stack frames vertically, UNION BY NAME: the output has the union of all column
 *  names (first-seen order); a frame missing a column contributes `null` for its
 *  rows. Identical schemas → a plain vertical concat. A shared column name with
 *  CONFLICTING types across frames is a `#TYPE!` (reject-on-mismatch — Polars'
 *  default, and consistent with Solenoid's type separation; no silent coercion). */
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

/** Side-by-side by POSITION: every column of every frame, in order, colliding names
 *  deduped; a shorter frame pads down with blanks (pandas concat(axis=1), R bind_cols
 *  — which errors on ragged input; we pad, like HSTACK). */
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

/** Dispatch a unary verb. Binary verbs (join/append/bindColumns) are separate entry points. */
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
// `normalize` is the DEFAULT mode for every criterion; `normalizeOverrides`
// (criterion name → mode) overrides it per column. Missing / non-numeric / error
// cells count as 0 (a blank you haven't scored); a logical cell coerces TRUE→1 /
// FALSE→0 (matching splitFrame).

export type DecisionNormalize = "none" | "max" | "rank";

function cellToScore(v: FrameCell): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0; // null / text → unscored (0). A per-cell error is caught earlier (propagated)
}

// `max` and `rank` BOTH land in [0,1] (max → [-1,1] if the column has negatives),
// so any mix of normalized columns stays comparable.
function normalizeColumn(vals: number[], mode: DecisionNormalize): number[] {
  if (mode === "none") return vals;
  if (mode === "max") {
    const denom = vals.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return denom === 0 ? vals.map(() => 0) : vals.map((v) => v / denom);
  }
  // rank → normalized competition rank in [0,1]: best (highest) = 1, worst = 0, ties
  // share (each value scored by the fraction of rows it strictly beats). Lone row → 1.
  const n = vals.length;
  if (n <= 1) return vals.map(() => 1);
  return vals.map((v) => vals.filter((o) => o < v).length / (n - 1));
}

// −0 flattens to 0 so a zero contribution under a negative weight can't print "-0".
const round4 = (n: number): number => {
  const r = Math.round(n * 1e4) / 1e4;
  return r === 0 ? 0 : r;
};

// Date columns are deliberately NOT criteria — a date's serial is never a
// meaningful "score". One definition, shared by the verb and the node (which needs
// the criteria NAMES, in this order, to align a weights frame to them by name).
export function decisionColumns(f: FrameValue): { labelCol: FrameColumn | null; criteriaCols: FrameColumn[] } {
  const labelCol = f.columns.find((c) => c.type === "string") ?? null;
  const criteriaCols = f.columns.filter(
    (c) => c !== labelCol && (c.type === "number" || c.type === "logical"),
  );
  return { labelCol, criteriaCols };
}

/** The criteria column names, in the order the weights list aligns to. */
export function decisionCriteria(f: FrameValue): string[] {
  return decisionColumns(f).criteriaCols.map((c) => c.name);
}

// ─── Criterion-keyed weights (a frame, not a list) ──────────────────────────────
// The DM weights and the Sensitivity scenarios both key BY CRITERION NAME off a frame's
// first text column (orderedColumnsAreFrames — the label rides the data, not a positional
// list). A criterion the frame omits weighs 1 and inherits the default normalize.

const critKey = (s: string): string => s.trim().toLowerCase();

/** The first text column: the Criterion names of a criterion-keyed frame. */
const criterionColumn = (f: FrameValue): FrameColumn | undefined => f.columns.find((c) => c.type === "string");

/** criterion name (trimmed, lower-cased) → its row index in a criterion-keyed frame. */
function criterionRowIndex(f: FrameValue): Map<string, number> {
  const m = new Map<string, number>();
  criterionColumn(f)?.values.forEach((v, i) => {
    if (typeof v === "string") { const k = critKey(v); if (k && !m.has(k)) m.set(k, i); }
  });
  return m;
}

const numOrNull = (v: FrameCell): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? (v ? 1 : 0) : null;

/** A Norm cell → a normalize mode; blank / unrecognized → null (inherit the default).
 *  Accepts the card's labels (Raw / ÷Max / Rank) and the raw enum (none / max / rank). */
export function parseNormalize(v: FrameCell): DecisionNormalize | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/[÷\s]/g, "");
  if (s === "raw" || s === "none") return "none";
  if (s === "max" || s === "divmax") return "max";
  if (s === "rank") return "rank";
  return null;
}

/** Per-criterion normalize overrides read from an optional `Norm` text column. */
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

/** A DM weights frame → weights aligned to `criteria` + per-criterion normalize overrides.
 *  First text column = Criterion; a number column named Weight/Value (else the first number
 *  column) = the weight; an optional Norm text column sets the per-criterion mode. Unwired
 *  (or a criterion the frame omits) → weight 1, default normalize. */
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

/** Allocator: read each category's [min, max] and value weight from `f`, run the chosen
 *  allocation mode (`allocateOps.ts`, no solver), and return a `Category · Allocation` frame.
 *  Columns are found by name (min / max / weight·value) with a fallback to the first two
 *  number columns for the range; ordered weights ride the frame's Weight column, not a wired
 *  list (orderedColumnsAreFrames). The allocation carries the min column's unit when it has one. */
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
  // Allocation is the first number column so a wired pie/chart plots it; Share is the raw
  // FRACTION of the spend (format it as a percent downstream, not by scaling here). Any
  // price comparison (the range, headroom) is a join/computed column downstream, not the
  // allocator's job. Allocation carries the min column's unit.
  const share = alloc.map((a) => (total > 0 ? a / total : 0));
  return {
    __frame: true,
    columns: [
      { name: nameCol?.name ?? "Category", type: "string", values: names },
      { name: "Allocation", type: "number", values: alloc, ...(minCol.unit ? { unit: minCol.unit } : {}) },
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
  // A per-cell error propagates rather than scoring 0; a `null` stays a deliberate blank.
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

  // Rounded on COMPUTE, not display, so rank and the shown Score can never
  // disagree: two options that print the same score share a rank.
  const scores: number[] = Array.from({ length: rows }, (_, i) => {
    let sw = 0;
    for (let j = 0; j < criteriaCols.length; j++) sw += effective[j][i] * weightOf(j);
    return round4(sumAbsW > 0 ? sw / sumAbsW : 0);
  });

  // Competition rank: equal scores share a rank, the next distinct score skips the
  // tied count.
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const rankByRow = new Array<number>(rows).fill(0);
  for (let k = 0; k < order.length; k++) {
    rankByRow[order[k].i] =
      k > 0 && order[k].s === order[k - 1].s ? rankByRow[order[k - 1].i] : k + 1;
  }

  const idx = order.map((o) => o.i);
  // Option · …criteria? · Score · Rank, best first; names run through makeHeaders so a
  // criterion named "Score"/"Rank" can't collide with the result columns.
  const out: FrameColumn[] = [
    { name: labelCol?.name ?? "Option", type: "string", values: idx.map((i) => labels[i]) },
  ];
  // Breakdown columns are SIGNED contributions — effective × weight / Σ|weight| —
  // so they sum to the Score (within rounding) and a negative-weight criterion
  // reads as the penalty it is, not as a high post-normalize value.
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
// `scenarios` is the DM weights frame widened to many scenarios: the first text column is
// the Criterion (rows), each NUMBER column is one scenario (its header names it) carrying
// that scenario's weight per criterion; an optional Norm column applies per criterion across
// every scenario. A criterion a scenario omits weighs 1. Output Cube row: Scenario · Winner ·
// Margin · Ranking (the full Option·Score·Rank table nested in the cell). Margin = top − runner-up.
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
  // With no criterion row matched, every weight defaults to 1 and all scenarios come out
  // identical — a naming mismatch (renamed criteria), not a sensitivity run.
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
      return v ?? 1; // missing weight → 1
    });
    const ranking = decisionMatrix(scores, weights, normalize, false, normOverrides);
    // Positional: breakdown=false fixes the shape to label · Score · Rank (a
    // criterion NAMED "Score" would defeat a find-by-name here).
    const scoreCol = ranking.columns[1];
    const rankCol = ranking.columns[2];
    const top = typeof scoreCol.values[0] === "number" ? (scoreCol.values[0] as number) : null;
    const second = typeof scoreCol.values[1] === "number" ? (scoreCol.values[1] as number) : null;

    scenarioCells.push(scenCol.name); // the scenario is the column header
    // Every option tied at rank 1 (best-first, so they lead the frame) — a dead
    // tie names them all rather than silently picking whichever sorted first.
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
// Run EAGERLY like Split Column / Add Index — materialization-boundary ops, with no
// native-engine mirror.

/** Fill blank (null) cells from the neighboring row: "down" carries the last
 *  present value forward, "up" the next one back — the classic un-merge of
 *  report-shaped tables. Empty `columns` = every column. Errors are values, not
 *  blanks: they neither fill nor get overwritten. */
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
    return { ...col, values };
  });
  return { __frame: true, columns: cols };
}

/** Coerce a replacement string to a column's type (the quiet-dirty-data rule:
 *  blank → null, unparseable → NaN for numbers / null otherwise). */
function coerceReplacement(t: FrameColType, text: string): FrameCell {
  const s = text.trim();
  if (s === "") return null;
  switch (t) {
    case "number": { const n = Number(s); return Number.isFinite(n) ? n : NaN; }
    case "date": { const n = Number(s); return Number.isFinite(n) ? n : null; }
    case "logical": {
      const l = s.toLowerCase();
      return l === "true" || l === "1" ? true : l === "false" || l === "0" ? false : null;
    }
    default: return text;
  }
}

/** Find → replace in a column ("" = every column). "cell" replaces whole cells
 *  whose text form equals `find` (numbers also match numerically, so "5" hits 5);
 *  "substring" rewrites occurrences inside STRING columns only. Case-sensitive,
 *  like every key comparison here (unlike Excel). The replacement coerces to the
 *  column's type; blanks and errors are never matched. */
export function replaceValues(
  f: FrameValue, column: string, find: string, replaceWith: string, mode: "cell" | "substring",
): FrameValue {
  if (find === "") return f;
  const targets = new Set((column.trim() ? [requireColumn(f, column.trim())] : f.columns).map((c) => c.name));
  const findNum = Number(find.trim());
  const numericFind = find.trim() !== "" && Number.isFinite(findNum);
  const cols = f.columns.map((col) => {
    if (!targets.has(col.name)) return col;
    if (mode === "substring") {
      if (col.type !== "string") return col;
      return {
        ...col,
        values: col.values.map((v) => (typeof v === "string" ? v.split(find).join(replaceWith) : v)),
      };
    }
    const replacement = coerceReplacement(col.type, replaceWith);
    return {
      ...col,
      values: col.values.map((v) => {
        if (v == null || isSolError(v)) return v;
        // ONE match rule, shared with Rust `lazy_replace_values`: a number matches by
        // numeric equality against the parsed find (a non-numeric find hits no number
        // cell); a boolean matches the words TRUE/FALSE case-insensitively (not 1/0); a
        // string matches exact text. Dates are serials, so they fall through the number arm.
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

/** Join two or more columns into one string column (separator between parts,
 *  blank cells contribute ""), inserted where the first source sat; the sources
 *  drop. The inverse of Split Column. Cells format per their column's type, so a
 *  date merges as its display text, not its serial. */
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

/** First row → column names (Power Query "Use First Row as Headers"). Blank
 *  header cells auto-name; duplicates uniquify. Column types stay — the cells
 *  below are unchanged. */
export function promoteHeaders(f: FrameValue): FrameValue {
  if (frameRowCount(f) === 0) return f;
  const names = f.columns.map((c) => {
    const v = c.values[0];
    if (v == null || isSolError(v)) return "";
    return String(formatFrameCell(c.type, v) ?? "").trim();
  });
  const unique = makeHeaders(names, f.columns.length);
  return { __frame: true, columns: f.columns.map((c, i) => ({ ...c, name: unique[i], values: c.values.slice(1) })) };
}

/** Column names → a first row of text (the inverse of promoteHeaders). Every
 *  column becomes a string column — the header row is text, so a typed column
 *  would otherwise be mixed. */
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

/** Drop rows whose cells are blank — "all" drops only fully-blank rows (the
 *  spacer rows), "any" keeps only complete rows. Errors are values, not blanks. */
export function dropBlankRows(f: FrameValue, mode: "all" | "any"): FrameValue {
  const rows = frameRowCount(f);
  const keep: number[] = [];
  for (let i = 0; i < rows; i++) {
    const blanks = f.columns.filter((c) => c.values[i] == null).length;
    const drop = mode === "all" ? blanks === f.columns.length : blanks > 0;
    if (!drop) keep.push(i);
  }
  return { __frame: true, columns: f.columns.map((c) => ({ ...c, values: keep.map((i) => c.values[i] ?? null) })) };
}

/** Row slices beyond head's first-N: last N, skip the first N, or a 1-based
 *  inclusive range — Power Query's Keep/Remove Rows family on one op. */
export function sliceRows(f: FrameValue, mode: "first" | "last" | "skip" | "range", n: number, to?: number): FrameValue {
  const rows = frameRowCount(f);
  const N = Math.max(0, Math.trunc(n));
  let start = 0, end = rows;
  if (mode === "first") end = Math.min(rows, N);
  else if (mode === "last") start = Math.max(0, rows - N);
  else if (mode === "skip") start = Math.min(rows, N);
  else { start = Math.max(0, Math.trunc(n) - 1); end = Math.min(rows, Math.trunc(to ?? n)); }
  if (end < start) end = start;
  return { __frame: true, columns: f.columns.map((c) => ({ ...c, values: c.values.slice(start, end) })) };
}

// ─── Describe (pandas describe / R summary) — one row per column ──────────────
/** Per-column profile: the three presence counts (present = valid + error, blank),
 *  distinct (over present non-errors), and for NUMBER/DATE columns the numeric stats
 *  (PERCENTILE.INC, pandas' linear). `error` is the SolError share of `count`; a
 *  non-numeric column leaves the stats null. Shared by `describeFrame` (the node) and
 *  the Table popup's summary footer. */
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
    distinct: new Set(present.filter((v) => !isSolError(v)).map((v) => (typeof v === "number" ? `#${v}` : typeof v === "boolean" ? `b${v}` : `s${v}`))).size,
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

/** One row per input column: count (present), blank, distinct, and for NUMBER columns
 *  mean / std (sample) / min / 25% / 50% / 75% / max (PERCENTILE.INC, pandas' linear).
 *  Text, date and logical columns carry the three counts and leave the numeric stats
 *  blank; a date column's min/max are dates (serials). Errors count as present. */
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

/** The pairwise correlation (or covariance) matrix of a frame's NUMBER columns as a
 *  frame: a leading `column` name column, then one column per variable (pandas df.corr /
 *  df.cov, R cor / cov with use="pairwise.complete.obs"): each pair drops the rows where
 *  either side is blank, so a patchy frame still answers; a pair with too little data or
 *  zero variance is a blank cell. Covariance is the SAMPLE covariance (pandas / R). */
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

// ─── Window functions by group (pandas groupby().transform / .over(), dplyr group_by %>%
// mutate, SQL OVER (PARTITION BY … ORDER BY …)) ────────────────────────────────────────
export type WindowFn =
  | "row_number" | "rank" | "dense_rank" | "percent_rank" | "ntile"
  | "cumsum" | "cumavg" | "cummin" | "cummax" | "cumcount"
  | "lag" | "lead" | "diff" | "pct_change"
  | "rolling_sum" | "rolling_avg" | "rolling_min" | "rolling_max"
  | "group_sum" | "group_avg" | "group_min" | "group_max" | "group_count" | "share" | "first" | "last";

export interface WindowSpec {
  /** Partition columns; empty = the whole frame is one group. */
  partitionBy: string[];
  /** Order within the partition; omitted = input row order. */
  orderBy?: string;
  orderDir?: "asc" | "desc";
  fn: WindowFn;
  /** The value column (ranks / row_number rank by `orderBy` and need no value column). */
  column?: string;
  /** Output column name. */
  as: string;
  /** lag/lead offset, rolling window size, or ntile buckets. */
  n?: number;
}

/** Which functions need the value column. */
export const WINDOW_FN_NEEDS_COLUMN: ReadonlySet<WindowFn> = new Set([
  "cumsum", "cumavg", "cummin", "cummax", "lag", "lead", "diff", "pct_change",
  "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
  "group_sum", "group_avg", "group_min", "group_max", "group_count", "share", "first", "last",
]);
/** Which functions read `n`. */
export const WINDOW_FN_NEEDS_N: ReadonlySet<WindowFn> = new Set(["lag", "lead", "rolling_sum", "rolling_avg", "rolling_min", "rolling_max", "ntile"]);

/** Append ONE computed column to the frame, evaluated per partition in the partition's
 *  order, then written back in the ORIGINAL row order (pandas transform semantics — the
 *  frame keeps its shape). Blanks: a blank value cell contributes nothing to sums/means
 *  and answers blank for its own row; ranks skip blank order keys (blank rank). Errors in
 *  the value column poison their partition's aggregate cells (#ERROR propagates). */
export function windowFrame(f: FrameValue, spec: WindowSpec): FrameValue {
  const n = frameRowCount(f);
  const keyCols = spec.partitionBy.map((k) => requireColumn(f, k));
  const orderCol = spec.orderBy ? requireColumn(f, spec.orderBy) : null;
  const valCol = WINDOW_FN_NEEDS_COLUMN.has(spec.fn) ? requireColumn(f, spec.column ?? "") : null;
  const N = Math.max(1, Math.round(spec.n ?? 1));
  // Partition: first-seen key order, rows in input order within a partition.
  const parts = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = JSON.stringify(keyCols.map((c) => encodeCell(cellAt(c, i))));
    const arr = parts.get(k); if (arr) arr.push(i); else parts.set(k, [i]);
  }
  const out: FrameCell[] = new Array<FrameCell>(n).fill(null);
  const cmp = (a: FrameCell, b: FrameCell): number => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "string" && typeof b === "string") return compareStrings(a, b);
    if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };
  for (const rows of parts.values()) {
    // Order within the partition (stable; blank order keys sort LAST, both directions).
    let ordered = rows;
    if (orderCol) {
      const dir = spec.orderDir === "desc" ? -1 : 1;
      ordered = [...rows].sort((i, j) => {
        const a = cellAt(orderCol, i), b = cellAt(orderCol, j);
        const aBlank = a == null || isSolError(a), bBlank = b == null || isSolError(b);
        if (aBlank || bBlank) return aBlank === bBlank ? i - j : aBlank ? 1 : -1;
        const c = cmp(a, b) * dir;
        return c !== 0 ? c : i - j;
      });
    }
    const vals = valCol ? ordered.map((i) => cellAt(valCol, i)) : [];
    const err = vals.find(isSolError);
    const nums = vals.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
    const present = nums.filter((v): v is number => v !== null);
    const orderVals = orderCol ? ordered.map((i) => cellAt(orderCol, i)) : [];
    const m = ordered.length;
    const groupAgg = (): FrameCell => {
      if (err) return err;
      if (present.length === 0) return spec.fn === "group_count" ? 0 : null;
      switch (spec.fn) {
        case "group_sum":   return present.reduce((a, b) => a + b, 0);
        case "group_avg":   return present.reduce((a, b) => a + b, 0) / present.length;
        case "group_min":   return Math.min(...present);
        case "group_max":   return Math.max(...present);
        case "group_count": return present.length;
        default: return null;
      }
    };
    for (let p = 0; p < m; p++) {
      const row = ordered[p];
      let v: FrameCell = null;
      switch (spec.fn) {
        case "row_number": v = p + 1; break;
        case "rank": case "dense_rank": case "percent_rank": {
          // Competition rank on the ORDER column (or position when none): ties share the
          // best rank; dense packs; percent = (rank − 1)/(m − 1) like dplyr / SQL.
          if (!orderCol) { v = spec.fn === "percent_rank" ? (m > 1 ? p / (m - 1) : 0) : p + 1; break; }
          const key = orderVals[p];
          if (key == null || isSolError(key)) { v = null; break; }
          if (spec.fn === "dense_rank") {
            // Same key as the previous row → its rank; else one more than the distinct keys before.
            if (p > 0 && cmp(orderVals[p], orderVals[p - 1]) === 0) v = out[ordered[p - 1]];
            else {
              let distinctBefore = 0;
              for (let q = 0; q < p; q++) if (q === 0 || cmp(orderVals[q], orderVals[q - 1]) !== 0) distinctBefore++;
              v = distinctBefore + 1;
            }
          } else {
            let first = p;
            while (first > 0 && cmp(orderVals[first - 1], key) === 0) first--;
            // percent_rank's denominator counts the RANKED rows (blank keys excluded — pandas rank(pct=True)).
            const ranked = orderVals.filter((k) => k != null && !isSolError(k)).length;
            v = spec.fn === "rank" ? first + 1 : (ranked > 1 ? first / (ranked - 1) : 0);
          }
          break;
        }
        case "ntile": v = Math.floor((p * N) / m) + 1; break;
        case "cumcount": v = p + 1; break;
        case "cumsum": case "cumavg": case "cummin": case "cummax": {
          if (err) { v = err; break; }
          const prefix = nums.slice(0, p + 1).filter((x): x is number => x !== null);
          if (nums[p] === null) { v = null; break; }
          if (prefix.length === 0) { v = null; break; }
          v = spec.fn === "cumsum" ? prefix.reduce((a, b) => a + b, 0)
            : spec.fn === "cumavg" ? prefix.reduce((a, b) => a + b, 0) / prefix.length
            : spec.fn === "cummin" ? Math.min(...prefix) : Math.max(...prefix);
          break;
        }
        case "lag": v = p - N >= 0 ? vals[p - N] : null; break;
        case "lead": v = p + N < m ? vals[p + N] : null; break;
        case "diff": case "pct_change": {
          const cur = nums[p], prev = p >= 1 ? nums[p - 1] : null;
          if (err) { v = err; break; }
          if (cur === null || prev === null) { v = null; break; }
          v = spec.fn === "diff" ? cur - prev : prev === 0 ? solError("#DIV/0!", "Percent change from zero is undefined") : (cur - prev) / prev;
          break;
        }
        case "rolling_sum": case "rolling_avg": case "rolling_min": case "rolling_max": {
          if (err) { v = err; break; }
          if (p < N - 1 || nums[p] === null) { v = null; break; }
          const win = nums.slice(p - N + 1, p + 1).filter((x): x is number => x !== null);
          if (win.length === 0) { v = null; break; }
          v = spec.fn === "rolling_sum" ? win.reduce((a, b) => a + b, 0)
            : spec.fn === "rolling_avg" ? win.reduce((a, b) => a + b, 0) / win.length
            : spec.fn === "rolling_min" ? Math.min(...win) : Math.max(...win);
          break;
        }
        case "group_sum": case "group_avg": case "group_min": case "group_max": case "group_count": v = groupAgg(); break;
        case "share": {
          if (err) { v = err; break; }
          const total = present.reduce((a, b) => a + b, 0);
          v = nums[p] === null ? null : total === 0 ? solError("#DIV/0!", "The group total is 0") : nums[p]! / total;
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
  return { __frame: true, columns: [...f.columns.filter((c) => c.name !== name), { name, type: outType, values: out }] };
}
