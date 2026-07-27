// ─── Relational verbs — the pure engine ───────────────────────────────────────
// One implementation of each relational verb, FrameValue → FrameValue (or a
// binary FrameValue × FrameValue → FrameValue for join/append). This is:
//   • the JS backend's `apply` body (web demo + dev path), and
//   • the reference oracle the Polars backend (desktop) is parity-tested against.
// Verb NODES (WS3) delegate here too, so there is ONE definition of "what FILTER
// means" rather than a node copy and a backend copy that drift.
//
// Pure + total: a verb returns a new FrameValue and never mutates its input (it
// may share unchanged columns' value arrays by reference — callers treat frames
// as immutable). A structural failure (a missing column) is a tagged SolError
// thrown, surfaced by the caller's error guard as #REF!. Value-model invariants
// hold: a column keeps its FrameColType; `null`/`SolError` cells ride through
// unless a verb's semantics say otherwise (documented per verb as they land).
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
import { parseDateToSerial } from "./nodes/date";

/** Group-aggregation ops (the GroupBy / PivotBy core). count = non-null cells
 *  (COUNTA); sum/avg/min/max/product/median/mode/stdev/var skip null and
 *  propagate a per-cell error (via forAggregate). `percentof` is the two-argument
 *  PIVOTBY op SUM(subset)/SUM(totalset) — it is resolved at pivot assembly (it
 *  needs the relative total set), not by `aggregateGroup`, which returns null for
 *  it. The set mirrors Excel PIVOTBY's eta-reduced lambdas (SUM, AVERAGE, COUNT,
 *  PRODUCT, MEDIAN, MODE.SNGL, STDEV.S/P, VAR.S/P, PERCENTOF). */
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
  | ({ kind: "pivot" } & PivotSpec); // long → wide cross-tab (Excel PIVOTBY)

/** One aggregation in a groupBy: aggregate `column` with `op`, output as `as`. */
export interface AggSpec { column: string; op: AggOp; as: string; }

const frame = (columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });

function requireColumn(f: FrameValue, name: string): FrameColumn {
  const col = f.columns.find((c) => c.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  return col;
}

// Non-finite numbers are REAL cells (B-1b, decided 2026-07-02 — supersedes
// audit finding 31, whose premise was "the IPC turns NaN into null"; the wire
// now carries ±Inf/NaN via the __nf sentinel, so the engine sees them too).
// Cross-backend behavior: distinct keys every non-finite into the shared
// ["#",null] bucket (JSON.stringify parity, pinned both sides); count counts
// them (they're present, not missing); sort puts NaN in the blanks-last tail
// (deterministic — see sortByColumn); aggregates classify non-finite results
// via guardFinite inside aggregateGroup.
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
 *  (so `1` ≠ `"1"`, `null` ≠ `0`, and an error keys by its code). */
function encodeCell(v: FrameCell): unknown {
  if (isSolError(v)) return ["e", v.code];
  if (v === null) return ["n"];
  if (typeof v === "boolean") return ["b", v];
  if (typeof v === "number") return ["#", v];
  return ["s", v];
}

/** Order rows by one column. Blanks (`null`) and per-cell errors sort LAST in
 *  both directions (Excel's blanks-last), stably; present values flip with dir.
 *  Stable on ties. */
export function sortByColumn(f: FrameValue, by: string, dir: "asc" | "desc"): FrameValue {
  const col = requireColumn(f, by);
  const cmp = comparatorFor(col.type);
  // NaN joins the tail: a `(a-b)` comparator makes NaN ordering depend on input
  // order (every comparison is false) — tail-last is the one deterministic spot,
  // matching the blanks/errors rule. ±Inf sorts normally (a real magnitude).
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

/** Deterministic SAMPLE for sketch mode (#24): up to `n` evenly-strided rows —
 *  NEVER random, so the same input always yields the same sample within a pass.
 *  A frame at or under `n` rows is returned unchanged (nothing to sample). Row
 *  order is preserved (the stride walks forward). Mirrors `headRows`'s
 *  index-list shape, but spread across the whole frame instead of a prefix, so
 *  a sample is representative rather than just "the first N rows". */
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
 *  type — the ONE spec both engines implement (audit finding 16; the two sides
 *  had drifted: JS `Number("")`=0 vs Rust NaN, JS truthy-"false"=1 vs Rust NaN).
 *  Logical columns go through coerceLogical (TRUE/FALSE/0/1 and the number
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

export function passesFilter(cell: FrameCell, op: FilterOp, value: FrameCell, type: FrameColType, matchCase: boolean): boolean {
  // The error + blank predicates run BEFORE the null/error guard below (which
  // excludes every error and null cell) — they exist to SELECT on those states.
  // `noterror` keeps a null (a null isn't an error); pair it with `notblank` to
  // drop both.
  if (op === "iserror")  return isSolError(cell);
  if (op === "noterror") return !isSolError(cell);
  // The blank predicates select on blankness (author 2026-07-16: blanks are data).
  // An error cell is present, not blank: isblank false, notblank true.
  if (op === "isblank")  return cell === null;
  if (op === "notblank") return cell !== null;
  if (cell === null || isSolError(cell)) return false;
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
  // `complement` keeps the rows the plain filter would discard — the ROW
  // complement, not predicate negation: a null/error cell fails its condition,
  // so under complement that row is KEPT (Kept ∪ Dropped = every row; the same
  // exhaustive-split rule as the list Filter's Dropped output).
  if (conditions.length === 0) return complement ? reorderRows(f, []) : f;
  const cols = conditions.map((c) => requireColumn(f, c.column));
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
  // Logical cells aggregate as 1/0 (SUM over a logical column = count of TRUEs)
  // — the Rust engine already coerced, the oracle silently skipped them.
  const prep = forAggregate(values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
  if (prep.error) return prep.error;
  // B-1b (decided 2026-07-02): ±Inf/NaN are REAL inputs, not filtered — Infinity
  // is first-class (SUM of ∞ is ∞) and dirty-data NaN must poison LOUDLY, never
  // vanish. Results are classified by guardFinite below; a NaN input poisons
  // deterministically up front (reduce-order NaN comparisons aren't).
  const nums = prep.nums;
  if (nums.length === 0) return op === "sum" ? 0 : op === "product" ? 1 : null;
  if (nums.some((n) => Number.isNaN(n))) return guardFinite(NaN, ...nums);
  return guardAgg(rawAggregate(nums, op), nums);
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
  const aggOut: FrameColumn[] = aggCols.map(({ spec, col }) => ({
    name: spec.as,
    // min/max preserve the SOURCE type (a min over a date column IS a date, not a
    // bare serial); sum/avg/count are always numeric.
    type: spec.op === "min" || spec.op === "max" ? col.type : "number",
    // The non-finite guard lives INSIDE aggregateGroup (B-1b) so pivot's
    // re-aggregating totals get it too — not just this verb.
    values: keyOrder.map((k) => aggregateGroup(buckets.get(k)!.map((i) => cellAt(col, i)), spec.op)),
  }));
  // De-dupe output names ("count of Region grouped by Region" collides the agg
  // `as` with the key) — two same-named columns here, a hard error in Rust
  // before it grew the same makeHeaders pass (audit finding 32).
  const out = [...keyOut, ...aggOut];
  const unique = makeHeaders(out.map((c) => c.name), out.length);
  out.forEach((c, i) => { c.name = unique[i]; });
  return frame(out);
}

/** Keep exactly `names`, in the given order. A missing name is a #REF!. */
export function selectColumns(f: FrameValue, names: readonly string[]): FrameValue {
  // Dedupe repeats, keeping the first: a duplicate selection made two
  // same-named columns here but a hard Polars error on desktop (finding 32).
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
export type JoinHow = "inner" | "left" | "right" | "outer" | "semi" | "anti" | "asof";
// backward = latest right key ≤ left key (Polars' default strategy); forward =
// earliest right key ≥ left key; nearest = whichever is closer (ties → backward).
export type AsofDirection = "backward" | "forward" | "nearest";
export interface JoinOpts {
  leftKey: string; rightKey: string; how: JoinHow;
  asofDirection?: AsofDirection; // only read when how === "asof"; default "backward"
  asofTolerance?: number;        // max |left-right| key distance; unset = unlimited
}

const encKey = (v: FrameCell): string => JSON.stringify(encodeCell(v));

/** Index a column's row positions by its key encoding. A `null` or error key is
 *  NOT indexed, so it never matches — SQL semantics and Polars' default
 *  `join_nulls=False` (null != null in a join). Keeps JS↔Polars row counts equal
 *  on data with blank keys; an unmatched null-key row still flows through
 *  left/right/outer as an unmatched row. */
function keyIndex(col: FrameColumn, n: number): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const cell = cellAt(col, i);
    if (cell === null || isSolError(cell)) continue; // null/error never join
    const k = encKey(cell);
    const bucket = idx.get(k);
    if (bucket) bucket.push(i); else idx.set(k, [i]);
  }
  return idx;
}

/** Build the oracle's join OUTPUT layout from resolved `pairs` — LEFT columns
 *  (key coalesced from whichever side is present) + RIGHT non-key columns,
 *  colliding names de-duped. Shared by every `how` (asof included): each `how`
 *  only differs in HOW `pairs` is resolved. */
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

/** As-of join: match each LEFT row (kept in ORIGINAL order — asof is always a
 *  left-driving match, never fans out) to the nearest RIGHT row by key, per
 *  `opts.asofDirection`/`asofTolerance`. Requires an orderable (number/date) key
 *  on both sides; a `null`/error key row never matches — same rule as an
 *  equality join. Mirrors Polars' `join_asof` (backward is its default). */
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
    if (cell === null || isSolError(cell)) continue;
    sortedRight.push({ key: Number(cell), idx: j });
  }
  sortedRight.sort((a, b) => a.key - b.key || a.idx - b.idx);
  const direction = opts.asofDirection ?? "backward";

  const ln = frameRowCount(left);
  const pairs: [number | null, number | null][] = [];
  for (let i = 0; i < ln; i++) {
    const cell = cellAt(lk, i);
    if (cell === null || isSolError(cell)) { pairs.push([i, null]); continue; }
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
export function joinFrames(left: FrameValue, right: FrameValue, opts: JoinOpts): FrameValue {
  const lk = requireColumn(left, opts.leftKey);
  const rk = requireColumn(right, opts.rightKey);
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

  // pairs of [leftRow | null, rightRow | null], in output order.
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
// Compare two frames by key: classify each key as added (right-only) / removed
// (left-only) / changed (a shared column differs) / unchanged, with a before /
// after / Δ per shared numeric column. When both a price and a quantity column
// are named (and both are numeric on both sides), also decomposes the total
// (price×qty) change into the textbook three-term PRICE / VOLUME / MIX variance —
// not novel math, the standard FP&A decomposition:
//   price  = (P1−P0)·Q0
//   volume = (Q1−Q0)·P0
//   mix    = (P1−P0)·(Q1−Q0)
// which sums EXACTLY to P1·Q1 − P0·Q0 (the total delta).
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
  /** Non-key columns present on only ONE side (a schema diff). A renamed column shows
   *  up as a removed + added pair. These do NOT drive row status — a one-sided column
   *  applies to every matched row equally — so they're surfaced here (and as labeled
   *  output columns) rather than making every row read "changed" or, worse, hiding the
   *  schema change behind an all-"unchanged" result. */
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

  // Shared non-key columns, matched by name — the delta candidates.
  const sharedCols = left.columns
    .filter((c) => c.name !== opts.leftKey)
    .map((c) => ({ name: c.name, left: c, right: right.columns.find((rc) => rc.name === c.name) ?? null }))
    .filter((s): s is { name: string; left: FrameColumn; right: FrameColumn } => s.right !== null);

  // Non-key columns on ONE side only — the schema diff. Surfaced so a renamed or
  // dropped/added column doesn't vanish (leaving an all-"unchanged" report that hides
  // the change). A removed column carries its before-values (null after); an added one
  // its after-values (null before), aligned to the same output rows via li/ri below.
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

  // Emit one output row (key + status + per-shared-column before/after/Δ). Shared by
  // the matched/added/removed rows AND the "skipped" keyless rows appended below, so
  // nothing silently vanishes from the output. PVM is NOT computed here — it's row-
  // shape-specific and handled inline in the match loop.
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
  // or non-numeric. The old code read the latter as 0 too, fabricating a bogus price/
  // volume swing with no flag — those rows are now excluded from the decomposition.
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

  // Finding (a): a row whose KEY is blank (null) or an error can't be matched — keyIndex
  // drops it, so it never entered `allKeys`. Rather than let it vanish from both the
  // output AND the counts, append it as its own "skipped" row (a left row shows its
  // before-values, a right row its after-values) and tally it, so the row total is honest.
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

  // Value-based sort: reorder whole row/col groups by a value column's grand total
  // (the displayed measure), the way Excel sorts a pivot by Sales. Stable; NaN/error
  // totals sort last. Intended for a single-level axis — it reorders leaves flatly.
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

/** UNNEST: expand a Cube's nested-frame column back to a flat frame — each parent
 *  row repeats once per child row, with the nested frame's columns appended.
 *  Parent rows whose nested frame is empty are dropped (standard unnest). Parent
 *  (flat) column types are re-inferred; nested column types are preserved. */
export function unnestCube(c: CubeValue, nestedColumn: string): FrameValue {
  const nestedIdx = c.columns.findIndex((col) => col.name === nestedColumn);
  if (nestedIdx < 0) throw solError("#REF!", `column "${nestedColumn}" not found`);
  const flatCols = c.columns.filter((_, j) => j !== nestedIdx);
  const nested = c.columns[nestedIdx];
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
 *  "apple"; audit finding 28); logical → 0/1 identity (so "1"/"true" both match
 *  TRUE); date → the lookup parsed as a serial (digits) or an ISO date;
 *  number → numeric. */
function keyMatches(cell: FrameCell, lookup: string, type: FrameColType): boolean {
  if (type === "string") return String(cell).toLowerCase() === lookup.toLowerCase();
  if (type === "logical") return (cell ? 1 : 0) === (coerceLogical(lookup) ? 1 : 0);
  if (type === "date") {
    const t = lookup.trim();
    const serial = /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : parseDateToSerial(t);
    return Number(cell) === serial;
  }
  return Number(cell) === Number(lookup); // number
}

/** XLOOKUP's `match_mode`: "exact" (default) requires an equal cell; "nextSmaller"/
 *  "nextLarger" fall back to the closest ≤/≥ row ONLY when no exact match exists
 *  (Excel's match_mode -1/1) — an exact hit always wins first. Approximate modes
 *  require an orderable (number/date) key column. */
export type LookupMatchMode = "exact" | "nextSmaller" | "nextLarger";

/** XLOOKUP's `search_mode`: which end to scan from — so which row wins when the
 *  key column has DUPLICATES. "first" (default, Excel's search_mode 1) returns the
 *  first match top-to-bottom; "last" (search_mode -1) returns the last. Excel's
 *  binary modes (2 / -2) are omitted: on a materialized column a binary search over
 *  sorted data finds the SAME row a linear scan does, so it's a pure speed knob with
 *  no distinct result here — and we always scan linearly for correctness. Affects
 *  exact matching; an approximate (≤/≥) match already picks the closest key. */
export type LookupSearchMode = "first" | "last";

/** XLOOKUP over a Frame: the FIRST row whose `lookupColumn` cell equals `lookup`
 *  (type-aware via keyMatches), returning that row's `returnColumn` cell.
 *  `undefined` when no row matches (the node turns that into If-not-found / #N/A);
 *  a missing column is a #REF! (thrown, surfaced by the caller's guard). A `null`
 *  or error key cell never matches — same rule as a join key. `matchMode` (default
 *  "exact") opts into an approximate fallback — see `LookupMatchMode`. */
export function lookupFrameCell(
  f: FrameValue, lookupColumn: string, returnColumn: string, lookup: string,
  matchMode: LookupMatchMode = "exact", searchMode: LookupSearchMode = "first",
): FrameCell | undefined {
  const idx = lookupFrameRowIndex(f, lookupColumn, lookup, matchMode, searchMode);
  const ret = requireColumn(f, returnColumn); // #REF! if the return column is missing (even on a miss)
  return idx < 0 ? undefined : cellAt(ret, idx);
}

/** The row-finding half of the frame XLOOKUP, shared by the single-cell return
 *  (`lookupFrameCell`) and the whole-row `*` return (`frameRowAt`) so both agree on
 *  which row matched. Returns the 0-based row index, or -1 for a miss. Only requires
 *  the KEY column (a missing key column is a #REF!; the return column is checked by
 *  the caller). A null / error key cell never matches — same rule as a join key. */
export function lookupFrameRowIndex(
  f: FrameValue, lookupColumn: string, lookup: string,
  matchMode: LookupMatchMode = "exact", searchMode: LookupSearchMode = "first",
): number {
  const key = requireColumn(f, lookupColumn);
  const n = frameRowCount(f);
  if (matchMode === "exact") {
    if (searchMode === "last") {
      for (let i = n - 1; i >= 0; i--) {
        const cell = cellAt(key, i);
        if (cell === null || isSolError(cell)) continue;
        if (keyMatches(cell, lookup, key.type)) return i;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const cell = cellAt(key, i);
        if (cell === null || isSolError(cell)) continue;
        if (keyMatches(cell, lookup, key.type)) return i;
      }
    }
    return -1;
  }
  if (!isOrderableKey(key.type)) {
    throw solError("#VALUE!", "Approximate lookup requires a numeric or date column");
  }
  const t = lookup.trim();
  const target = key.type === "date"
    ? (/^-?\d+(\.\d+)?$/.test(t) ? Number(t) : parseDateToSerial(t))
    : Number(t);
  if (!Number.isFinite(target)) return -1;
  let bestIdx = -1, bestKey = NaN;
  for (let i = 0; i < n; i++) {
    const cell = cellAt(key, i);
    if (cell === null || isSolError(cell)) continue;
    const k = Number(cell);
    if (k === target) return i; // exact match always wins, first-seen
    if (matchMode === "nextSmaller" && k < target && (bestIdx === -1 || k > bestKey)) { bestIdx = i; bestKey = k; }
    if (matchMode === "nextLarger" && k > target && (bestIdx === -1 || k < bestKey)) { bestIdx = i; bestKey = k; }
  }
  return bestIdx;
}

/** A cube's top-level column by name, or a #REF! (thrown; the caller's guard
 *  renders it). Mirrors `requireColumn` for frames. */
function requireCubeColumn(c: CubeValue, name: string): CubeColumn {
  const col = c.columns.find((k) => k.name === name);
  if (!col) throw solError("#REF!", `column "${name}" not found`);
  return col;
}

/** The FALLBACK key type when a cube column has no carried `type` (a hand-built cube;
 *  a frame-derived one now carries it — typed CubeColumn). Inferred from the flat
 *  SCALAR cells: all-number → number, all-boolean → logical, otherwise string. Never
 *  "date" by inference — a date and a plain number are indistinguishable as serials,
 *  so an UNTYPED cube date column matches numerically (look it up by serial, or carry
 *  the type via frame→cube). null / error / nested-container cells are ignored (a
 *  container can't be a lookup key). */
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

/** XLOOKUP over a Cube — the cube half of Frame Lookup (see docs/cube-node-scope.md).
 *  Matches `lookup` against one TOP-LEVEL column and returns the matched row's cell
 *  from another top-level column, WHOLE: a nested frame/cube cell comes out intact,
 *  so you look a key up in a cube and keep working on the sub-table (drilling into
 *  it is INDEX / the CubePopup's job, not the lookup's). Operates on the cube's own
 *  flat columns only — it never descends into nested cells (the "a verb works on the
 *  level it's handed" rule). `undefined` when no row matches (the node turns that
 *  into If-not-found / #N/A); a missing column is #REF!. A null / error / nested-
 *  container key cell never matches — same first-match-wins + join-key rules as
 *  `lookupFrameCell`. `matchMode` approximate fallback needs a numeric key column. */
export function lookupCubeCell(
  c: CubeValue, lookupColumn: string, returnColumn: string, lookup: string,
  matchMode: LookupMatchMode = "exact", searchMode: LookupSearchMode = "first",
): CubeCell | undefined {
  const idx = lookupCubeRowIndex(c, lookupColumn, lookup, matchMode, searchMode);
  const ret = requireCubeColumn(c, returnColumn); // #REF! if the return column is missing
  if (idx < 0) return undefined;
  return idx < ret.cells.length ? ret.cells[idx] ?? null : null;
}

/** The row-finding half of the cube XLOOKUP — shared by cell return and whole-row
 *  `*` return (`cubeRowAt`). Returns the matched 0-based row index, or -1. Only the
 *  KEY column is required (#REF! if missing). A null / error / nested-container key
 *  cell is never a key (same first-match-wins + join-key rules as the frame path). */
export function lookupCubeRowIndex(
  c: CubeValue, lookupColumn: string, lookup: string,
  matchMode: LookupMatchMode = "exact", searchMode: LookupSearchMode = "first",
): number {
  const key = requireCubeColumn(c, lookupColumn);
  const n = cubeRowCount(c);
  // Prefer the column's CARRIED type — frame→cube now preserves it (typed CubeColumn),
  // so a date-keyed cube column matches an ISO-date lookup like the frame path does.
  // Fall back to inferring from the flat cells for a hand-built (untyped) cube.
  const keyType = key.type ?? inferCubeKeyType(key);
  // A key cell usable for matching: a flat scalar only (a nested frame/cube/list is
  // never a key). Returns undefined for a non-key cell (null/error/container).
  const scalarAt = (i: number): FrameCell | undefined => {
    const cell = i < key.cells.length ? key.cells[i] : null;
    if (typeof cell === "number" || typeof cell === "string" || typeof cell === "boolean") return cell;
    return undefined;
  };
  if (matchMode === "exact") {
    if (searchMode === "last") {
      for (let i = n - 1; i >= 0; i--) {
        const cell = scalarAt(i);
        if (cell === undefined) continue;
        if (keyMatches(cell, lookup, keyType)) return i;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const cell = scalarAt(i);
        if (cell === undefined) continue;
        if (keyMatches(cell, lookup, keyType)) return i;
      }
    }
    return -1;
  }
  if (keyType !== "number" && keyType !== "date") {
    throw solError("#VALUE!", "Approximate lookup requires a numeric or date key column");
  }
  const t = lookup.trim();
  const target = keyType === "date"
    ? (/^-?\d+(\.\d+)?$/.test(t) ? Number(t) : parseDateToSerial(t))
    : Number(t);
  if (!Number.isFinite(target)) return -1;
  let bestIdx = -1, bestKey = NaN;
  for (let i = 0; i < n; i++) {
    const cell = scalarAt(i);
    if (typeof cell !== "number") continue;
    if (cell === target) return i; // an exact match always wins first
    if (matchMode === "nextSmaller" && cell < target && (bestIdx === -1 || cell > bestKey)) { bestIdx = i; bestKey = cell; }
    if (matchMode === "nextLarger" && cell > target && (bestIdx === -1 || cell < bestKey)) { bestIdx = i; bestKey = cell; }
  }
  return bestIdx;
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

// The source is an `any` socket so XLOOKUP takes a Frame OR a Cube (a cube can't
// narrow into a frame socket — sockets.ts): a cube flows to the cube path, a frame
// to the frame path. A bare list/matrix/scalar widens into a frame exactly as a
// `frame` socket would (a list-of-rows reads as a table; a flat list as one row),
// so two aligned lists reach XLOOKUP by way of Build Frame. null → no source.
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

/** Dispatch a unary verb. Binary verbs (join/append) are separate entry points. */
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
  }
}

// ─── Decision matrix (weighted scoring) ────────────────────────────────────────
// A port of the jortscity Decision Matrix Bases View. Given a Frame whose rows are
// options and whose numeric columns are scoring criteria (an optional leading text
// column names the options), score each option by the weighted average
//   Σ(score × weight) / Σ|weight|
// over the criteria, then competition-rank the options (ties share a rank). Using
// Σ|weight| as the denominator is what lets a NEGATIVE weight penalise a criterion
// where higher is worse (cost, risk) without skewing the scale.
//
// `normalize` makes criteria on incompatible scales comparable BEFORE weighting.
// It's the DEFAULT mode for every criterion; `normalizeOverrides` (criterion name →
// mode) overrides it per column — that's the DMBV per-column "Rank Raws" (rank only
// the $-scale columns, leave the /10 ones raw). The three modes:
//   • none — score with the raw values as-is.
//   • max  — divide each criterion column by its largest magnitude (→ [0,1], or
//            [-1,1] with negatives); the original DMBV "Normalize".
//   • rank — replace each column's values with their within-column competition rank,
//            normalized to [0,1] (best → 1, worst → 0); the DMBV "Rank Raws", which
//            makes "$ vs out-of-10" comparable since only the order is kept.
// max and rank share the [0,1] range, so mixing them across columns stays fair.
// Missing / non-numeric / error cells count as 0 (a blank you haven't scored); a
// logical cell coerces TRUE→1 / FALSE→0 (matching splitFrame). See decisionColumns
// for which columns become criteria.

export type DecisionNormalize = "none" | "max" | "rank";

function cellToScore(v: FrameCell): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0; // null / text → unscored (0). A per-cell error is caught earlier (propagated)
}

// Normalize a criterion column so weights — not raw scale — decide influence. `max`
// and `rank` BOTH land in [0,1] (max → [-1,1] if the column has negatives), so any
// mix of normalized columns is comparable; `none` leaves raw values (use when the
// criteria already share a scale, or you want their real magnitudes).
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

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// The first text column (if any) names the options; number/logical columns are the
// criteria. Date columns are deliberately NOT criteria — a date's serial is never a
// meaningful "score". One definition, shared by the verb and the node (which needs
// the criteria NAMES to render a labeled weight box per criterion, in this order).
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
  // A per-cell error in a criterion poisons the score — propagate it (error-in →
  // error-out, the same as groupBy/pivot) rather than silently scoring it as 0. A
  // `null` cell stays a deliberate blank (0); only a tagged SolError propagates.
  for (const c of criteriaCols) {
    for (const v of c.values) if (isSolError(v)) throw v;
  }

  const labels: FrameCell[] = labelCol
    ? Array.from({ length: rows }, (_, i) => labelCol.values[i] ?? null)
    : Array.from({ length: rows }, (_, i) => `Option ${i + 1}`);

  // Per-criterion effective values: each column normalized by its own mode (its
  // override, else the node default) — so Rank Raws can apply to just the $ columns.
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
    return sumAbsW > 0 ? sw / sumAbsW : 0;
  });

  // Order rows best-first; competition-rank (equal scores share a rank, the next
  // distinct score skips the tied count).
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const rankByRow = new Array<number>(rows).fill(0);
  for (let k = 0; k < order.length; k++) {
    rankByRow[order[k].i] =
      k > 0 && order[k].s === order[k - 1].s ? rankByRow[order[k - 1].i] : k + 1;
  }

  const idx = order.map((o) => o.i);
  // Always Option · …criteria? · Score · Rank, best first. With `breakdown` on, the
  // per-criterion EFFECTIVE (post-normalize) value each option contributed is shown
  // between the label and the Score — so under "rank"/"÷max" you see the transformed
  // value that was actually scored (the DMBV "rank shown alongside the raw" idea),
  // and under "none" you just see the raw scores. Names run through makeHeaders so a
  // criterion literally named "Score"/"Rank" can't collide with the result columns.
  const out: FrameColumn[] = [
    { name: labelCol?.name ?? "Option", type: "string", values: idx.map((i) => labels[i]) },
  ];
  if (breakdown) {
    criteriaCols.forEach((c, j) => {
      out.push({ name: c.name, type: "number", values: idx.map((i) => round4(effective[j][i])) });
    });
  }
  out.push({ name: "Score", type: "number", values: idx.map((i) => round4(scores[i])) });
  out.push({ name: "Rank", type: "number", values: idx.map((i) => rankByRow[i]) });

  const names = makeHeaders(out.map((c) => c.name), out.length);
  return { __frame: true, columns: out.map((c, k) => ({ ...c, name: names[k] })) };
}

// ─── Decision matrix sensitivity (weight scenarios → a Cube of rankings) ────────
// "How robust is the winner to the weights I chose?" Score the SAME options under
// several weight scenarios and see whether the ranking holds. `scenarios` is a Frame
// where each ROW is a scenario: its first text column names the scenario, and a
// numeric column named after a criterion gives that criterion's weight in that
// scenario (a missing/blank weight defaults to 1). For each scenario we run the
// decision matrix and emit one Cube row: Scenario · Winner · Margin · Ranking, where
// Ranking is the full Option·Score·Rank table NESTED in the cell (drill in to see it)
// — the natural Cube use: a table per row. Margin = top score − runner-up, a quick
// "how decisive" gauge (a thin margin = the choice flips easily). This is why a Cube
// and not a flat frame: each scenario carries a whole sub-table, not one value.
export function decisionSensitivity(
  scores: FrameValue,
  scenarios: FrameValue,
  normalize: DecisionNormalize,
): CubeValue {
  const criteria = decisionCriteria(scores);
  if (criteria.length === 0) {
    throw solError("#VALUE!", "Decision Matrix needs at least one numeric criterion column");
  }

  const nScen = frameRowCount(scenarios);
  const scenLabelCol = scenarios.columns.find((c) => c.type === "string") ?? null;
  const weightColFor = (name: string) => scenarios.columns.find((c) => c.name === name) ?? null;

  const scenarioCells: CubeCell[] = [];
  const winnerCells: CubeCell[] = [];
  const marginCells: CubeCell[] = [];
  const rankingCells: CubeCell[] = [];

  for (let i = 0; i < nScen; i++) {
    const weights = criteria.map((name) => {
      const v = weightColFor(name)?.values[i];
      return typeof v === "number" && Number.isFinite(v) ? v : 1; // missing weight → 1
    });
    const ranking = decisionMatrix(scores, weights, normalize, false);
    const scoreCol = ranking.columns.find((c) => c.name === "Score")!;
    const top = typeof scoreCol.values[0] === "number" ? (scoreCol.values[0] as number) : null;
    const second = typeof scoreCol.values[1] === "number" ? (scoreCol.values[1] as number) : null;

    scenarioCells.push(scenLabelCol ? (scenLabelCol.values[i] ?? `Scenario ${i + 1}`) : `Scenario ${i + 1}`);
    winnerCells.push(ranking.columns[0].values[0] ?? null); // rank-1 option (best-first)
    marginCells.push(top !== null && second !== null ? round4(top - second) : null);
    rankingCells.push(ranking);
  }

  return cubeFromColumns([
    { name: scenLabelCol?.name ?? "Scenario", cells: scenarioCells },
    { name: "Winner", cells: winnerCells },
    { name: "Margin", cells: marginCells },
    { name: "Ranking", cells: rankingCells },
  ]);
}

// ─── Timesaver verbs (2026-07-16) ────────────────────────────────────────────────
// The everyday Power Query cleanup set, run EAGERLY like Split Column / Add Index
// (materialization-boundary ops — no native-engine mirror needed; a lazy Polars
// path is a perf follow-up if a real workload ever demands it).

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
        const hit = typeof v === "number"
          ? (numericFind && v === findNum) || String(v) === find
          : typeof v === "boolean"
            ? (v ? "TRUE" : "FALSE") === find || String(v) === find.toLowerCase()
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

/** A frame's numeric body as the COORDINATE-BORDERED grid Surface / Contour /
 *  Grid Interpolate read: row 0 = column indices, column 0 = row indices (both
 *  counting from `start`), corner blank, non-numeric cells blank. Add Index's
 *  two-way output. */
export function borderedGridFromFrame(f: FrameValue, start = 1): (number | null)[][] {
  const rows = frameRowCount(f);
  const header: (number | null)[] = [null, ...f.columns.map((_, j) => start + j)];
  const out: (number | null)[][] = [header];
  for (let i = 0; i < rows; i++) {
    out.push([start + i, ...f.columns.map((c) => {
      const v = c.values[i];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    })]);
  }
  return out;
}
