import { ClassicPreset } from "rete";
import { numIn, numListIn, tableIn, tableOut, strTableOut, dateTableOut, logicalTableOut, listIn, listOut, strIn, strOut, strListIn, strListOut, dateListIn, dateListOut, logicalListIn, logicalListOut, frameIn, frameOut, cubeIn, cubeOut, anyOut } from "./shared";
import { toMatrix } from "./coerce";
import { parseDateToSerial } from "./date";
import { isSolError, solError, type SolError } from "../errorValue";
import { coerceLogical } from "../valueKinds";
import { APP_LOCALE } from "../locale";
import {
  buildFrame, splitFrame, getColumn, addColumn, frameRowCount, frameHasTextColumns,
  frameFromInputText, formatFrameCell, isCubeValue, isFrameValue,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "../frame";
import {
  pivotFrame, nestFrame, unnestCube,
  splitColumn, addIndexColumn, decisionMatrix, decisionCriteria, decisionSensitivity,
  lookupFrameCell, lookupCubeCell, lookupFrameRowIndex, lookupCubeRowIndex,
  frameRowAt, cubeRowAt, asLookupSource, reconcileFrames,
  type FilterOp, type FilterCond, type FilterCombine, type JoinHow, type AsofDirection, type AggOp, type DecisionNormalize, type LookupMatchMode, type LookupSearchMode, type ReconcileSummary,
} from "../frameVerbs";
import { pairIdsFromKeys } from "./logic";
import type { PivotSpec } from "../frameVerbs";
import { runFrameUnary, runFrameJoin, runFrameAppend, readFrame, collectPreview, dropFrameRef, isFrameRef, frameBackend, materialize, flushRef, type FrameInput, type FrameRef } from "../frameBackend";
import type { CubeValue, CubeCell } from "../frame";

// A verb that may throw a tagged SolError (a #REF! for a bad column) must NOT let
// it escape data(): installErrorGuards' fromThrown flattens a thrown SolError to a
// generic #ERROR!. Catch it and return it as a VALUE so the display shows the real
// code (subsystem-invariants §4.3 / the materialize() bridge).
function runVerb<T>(fn: () => T): T | SolError {
  try {
    return fn();
  } catch (e) {
    return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
  }
}

// ─── Lazy verb-node output ──────────────────────────────────────────────────────
// A verb node's data() emits a LAZY FrameRef on its cable (so a chain of verbs never
// round-trips the frame — see frameBackend), but its card still needs a real frame.
// emitFrame collects the ref into `cachedResult` for the card, drops the node's
// PREVIOUS owned ref (the backend's frames are independent, so this is safe), and
// returns the ref as the cable value. A passthrough (no-op verb) must pass a VALUE,
// not the upstream ref it doesn't own — callers do `readFrame(f)` for that case.
interface FrameVerbNode { _ref?: FrameRef | null; _gen?: number; cachedResult: FrameValue | SolError | null }

/** Stamp a new compute pass on the node — the guard against OUT-OF-ORDER passes
 *  (audit finding 19): a superseded pass's data() isn't aborted, only its result
 *  discarded, so a stale pass resolving late would otherwise drop the LIVE ref
 *  the fresh pass just published and install its own stale ref + preview.
 *  MUST be evaluated before the verb's await — the `emitFrame(this,
 *  beginPass(this), await …)` argument order guarantees exactly that. */
function beginPass(node: FrameVerbNode): number {
  node._gen = (node._gen ?? 0) + 1;
  return node._gen;
}

async function emitFrame(node: FrameVerbNode, gen: number, out: FrameRef | FrameValue | SolError | null): Promise<{ frame: FrameRef | FrameValue | SolError | null }> {
  // Stale pass: leave the node's live ref/preview alone; free the orphan result
  // handle (nothing else owns it — rete discards the stale data() result).
  const stale = () => {
    if (isFrameRef(out) && out !== node._ref) dropFrameRef(out);
    return { frame: null };
  };
  if (gen !== node._gen) return stale();
  const preview = await collectPreview(out); // head-N for a large frame; full for a small one
  if (gen !== node._gen) return stale(); // a newer pass finished during the collect
  if (node._ref && node._ref !== out) dropFrameRef(node._ref);
  node._ref = isFrameRef(out) ? out : null;
  node.cachedResult = preview;
  return { frame: out };
}

// ─── Frame nodes ──────────────────────────────────────────────────────────────
// The data-table family. Build / Split are the literal Matrix ⇄ Frame adapter;
// Get Column / Add Column are the per-column path. Everything per-column or
// per-cell reuses the existing list / matrix nodes via these, so there are no
// redundant frame-side aggregation or math nodes. See docs/dev-notes.md.

// ─── FRAME INPUT ─────────────────────────────────────────────────────────────
// A source node: type a data table directly. Like Table Input, the result box
// doubles as the editor — its chip opens the grid popup (editable cells + column
// names), and Save writes back through `frameText`. v1 columns are all numeric;
// only the names are editable (the rest of the frame family is numeric-only too).

export class FrameInputNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | null = null;
  frameText: string;
  // Signature of the text `cachedResult` was built from. Rebuilding a fresh
  // FrameValue every data() call defeats the backend's identity source-cache (each
  // recompute re-uploads the same frame to Rust); return the SAME object while the
  // text is unchanged so the handle is reused. A real edit changes frameText → rebuild.
  private _builtFrom: string | undefined;
  width = 240; height = 220;

  constructor(init?: { label?: string; frameText?: string }) {
    super("FrameInput");
    this.label = init?.label ?? "Frame Input";
    this.frameText = init?.frameText ?? "A, B\n1, 2\n3, 4";
    this.addOutput("frame", frameOut("Frame"));
  }

  data() {
    if (!this.cachedResult || this._builtFrom !== this.frameText) {
      this.cachedResult = frameFromInputText(this.frameText);
      this._builtFrom = this.frameText;
    }
    return { frame: this.cachedResult };
  }
}

// ─── DISTINCT ────────────────────────────────────────────────────────────────
// Remove duplicate ROWS from a Frame, keeping the first of each (the frame analog
// of the list UNIQUE). Delegates to the pure `distinctRows` verb (frameVerbs.ts),
// the same definition the relational engine + the Polars backend use. v1 is
// distinct-on-all-columns; a column-subset input is a later add (it can #REF! a
// bad name, which needs the error-in-FrameDisplay path first).

export class DistinctNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  width = 180; height = 120;

  constructor(init?: { label?: string }) {
    super("Distinct");
    this.label = init?.label ?? "Distinct";
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("frame", frameOut("Unique"));
  }

  async data(inputs: { frame?: (FrameInput | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    return emitFrame(this, beginPass(this), f != null ? await runFrameUnary(f, { kind: "distinct" }) : null);
  }
}

// ─── HEAD ────────────────────────────────────────────────────────────────────
// The first N rows of a Frame (verb: headRows). N from the wired/typed input.

export class HeadNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  literals: Record<string, number> = { rows: 10 };
  width = 180; height = 150;

  constructor(init?: { label?: string }) {
    super("Head");
    this.label = init?.label ?? "Head";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("rows", numIn("Rows"));
    this.addOutput("frame", frameOut("Head"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; rows?: number[] }) {
    const f = inputs.frame?.[0] ?? null;
    const n = inputs.rows?.[0] ?? this.literals.rows ?? 10;
    return emitFrame(this, beginPass(this), f != null ? await runFrameUnary(f, { kind: "head", n }) : null);
  }
}

// ─── SORT FRAME ────────────────────────────────────────────────────────────────
// Order rows by one column (verb: sortByColumn); blanks/errors sort last. The
// column is named (typed/wired, like Get Column); `dir` is a SegToggle field.

export type FrameSortDir = "asc" | "desc";

export class SortFrameNode extends ClassicPreset.Node {
  label: string;
  dir: FrameSortDir;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "" };
  width = 190; height = 175;

  constructor(init?: { label?: string; dir?: FrameSortDir }) {
    super("SortFrame");
    this.label = init?.label ?? "Sort";
    this.dir = init?.dir ?? "asc";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("column", strIn("Column"));
    this.addOutput("frame", frameOut("Sorted"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; column?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    const col = (inputs.column?.[0] ?? this.stringLiterals.column ?? "").trim();
    if (f == null) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), col === "" ? await readFrame(f) : await runFrameUnary(f, { kind: "sort", by: col, dir: this.dir }));
  }
}

// ─── FILTER FRAME ──────────────────────────────────────────────────────────────
// Keep rows passing extensible CONDITION rows combined with AND/OR (verb:
// filterMulti, B-2 — SQL WHERE made visual). Each row: a column, an op (9
// comparisons + text predicates), a value, and its OWN Match-case flag (text
// matching ignores case by default — Excel's `=`). Pair `id` owns the wireable
// `column${id}` / `value${id}` inputs plus a `condConfig[id]` {op, matchCase}.
// A row missing its column or value is "not written yet" → EXCLUDED from the
// predicate (the audit-16 policy, now per-row); no complete rows = pass-through.
// Blanks/errors in the data fail that row's condition (under OR another
// condition can still keep the row).

export interface FilterCondConfig { op: FilterOp; matchCase?: boolean }

export class FilterFrameNode extends ClassicPreset.Node {
  label: string;
  combine: FilterCombine;
  /** Per-pair {op, matchCase}, keyed by the pair id (the `column${id}` suffix). */
  condConfig: Record<string, FilterCondConfig> = {};
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["Column", "Value"];
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = {};
  width = 210; height = 240;

  constructor(init?: {
    label?: string; combine?: FilterCombine;
    condConfig?: Record<string, FilterCondConfig>; valueKeys?: string[];
  }) {
    super("FilterFrame");
    this.label = init?.label ?? "Filter Rows";
    this.combine = init?.combine ?? "and";
    this.addInput("frame", frameIn("Frame"));
    const ids = pairIdsFromKeys(init?.valueKeys, "column");
    if (ids.length) {
      // Restore saved rows; copy only LIVE ids' config (prunes entries orphaned
      // by a removed row — removal keeps them for undo, reload drops them).
      for (const id of ids) this.addPairWithId(id);
      for (const id of ids) {
        const cfg = init?.condConfig?.[String(id)];
        if (cfg) this.condConfig[String(id)] = { ...cfg };
      }
    } else {
      this.addValuePair();
    }
    this.addOutput("frame", frameOut("Kept"));
  }

  private addPairWithId(id: number): void {
    this.addInput(`column${id}`, strIn(`Column ${id + 1}`));
    this.addInput(`value${id}`, strIn(`Value ${id + 1}`));
    if (!this.condConfig[String(id)]) this.condConfig[String(id)] = { op: "gt" };
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

  removeValuePair(aKey: string): void {
    const id = aKey.slice(6);
    this.removeInput(`column${id}`);
    this.removeInput(`value${id}`);
    delete this.stringLiterals[`column${id}`];
    delete this.stringLiterals[`value${id}`];
    // condConfig[id] is kept: row-removal undo re-adds the same input keys, and
    // the surviving entry restores its op/matchCase; reload prunes orphans.
  }

  async data(inputs: { frame?: (FrameInput | null)[]; [k: string]: unknown[] | undefined }) {
    const f = inputs.frame?.[0] ?? null;
    if (f == null) return emitFrame(this, beginPass(this), null);
    const conditions: FilterCond[] = [];
    for (const [colKey, valKey] of this.valuePairKeys()) {
      const id = colKey.slice(6);
      const col = String((inputs[colKey] as string[] | undefined)?.[0] ?? this.stringLiterals[colKey] ?? "").trim();
      const val = (inputs[valKey] as string[] | undefined)?.[0] ?? this.stringLiterals[valKey] ?? "";
      if (col === "" || String(val).trim() === "") continue;
      const cfg = this.condConfig[id];
      conditions.push({ column: col, op: cfg?.op ?? "gt", value: val as FrameCell, matchCase: cfg?.matchCase ?? false });
    }
    return emitFrame(this, beginPass(this), conditions.length === 0
      ? await readFrame(f)
      : await runFrameUnary(f, { kind: "filterMulti", combine: this.combine, conditions }));
  }
}

// ─── JOIN ──────────────────────────────────────────────────────────────────────
// Relational join of two Frames on a key (verb: joinFrames). inner/left/right/
// outer/asof via the `how` SegToggle; a left row matching several right rows
// fans out (asof never fans out — one match per left row). Right key defaults
// to the left key's name (the common same-name case). `asofDirection`/
// `asofTolerance` are read only when how === "asof" (an orderable number/date
// key); Tolerance blank = unlimited.

export class JoinNode extends ClassicPreset.Node {
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

  async data(inputs: {
    left?: (FrameInput | null)[]; right?: (FrameInput | null)[];
    leftKey?: string[]; rightKey?: string[]; tolerance?: number[];
  }) {
    const left = inputs.left?.[0] ?? null;
    const right = inputs.right?.[0] ?? null;
    const lk = (inputs.leftKey?.[0] ?? this.stringLiterals.leftKey ?? "").trim();
    const rk = (inputs.rightKey?.[0] ?? this.stringLiterals.rightKey ?? "").trim() || lk;
    const tolerance = inputs.tolerance?.[0] ?? this.literals.tolerance;
    if (left == null || right == null || lk === "") return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), await runFrameJoin(left, right, {
      leftKey: lk, rightKey: rk, how: this.how,
      asofDirection: this.asofDirection, asofTolerance: tolerance,
    }));
  }
}

// ─── SELECT / DROP COLUMNS ───────────────────────────────────────────────────
// Keep or drop a set of named columns (verbs: selectColumns / dropColumns). The
// column list is a typeable strlist ("name, qty"). Select #REF!s a missing name;
// Drop ignores unknowns. An empty list passes the frame through unchanged.

export class SelectColumnsNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  width = 190; height = 150;

  constructor(init?: { label?: string }) {
    super("SelectColumns");
    this.label = init?.label ?? "Select Columns";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("columns", strListIn("Keep"));
    this.addOutput("frame", frameOut("Frame"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; columns?: string[][] }) {
    const f = inputs.frame?.[0] ?? null;
    const cols = inputs.columns?.[0] ?? [];
    if (f == null) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), cols.length ? await runFrameUnary(f, { kind: "select", columns: cols }) : await readFrame(f));
  }
}

export class DropColumnsNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  width = 190; height = 150;

  constructor(init?: { label?: string }) {
    super("DropColumns");
    this.label = init?.label ?? "Drop Columns";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("columns", strListIn("Drop"));
    this.addOutput("frame", frameOut("Frame"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; columns?: string[][] }) {
    const f = inputs.frame?.[0] ?? null;
    const cols = inputs.columns?.[0] ?? [];
    return emitFrame(this, beginPass(this), f != null ? await runFrameUnary(f, { kind: "drop", columns: cols }) : null);
  }
}

// ─── GROUP BY (FRAME) ──────────────────────────────────────────────────────────
// Group rows by one or more key columns and aggregate one column (verb:
// groupByFrame). Single aggregation for v1 (the aggregated column keeps its name);
// the op is sum/avg/min/max/count. Distinct from the 1-D GroupByNode (list→list).
// `totalDepth` (Excel GROUPBY's total_depth: 0 none · 1 grand · 2 grand+subtotals ·
// negative ⇒ placed at top) adds total rows by routing a no-colFields pivotFrame —
// the pivot engine RE-AGGREGATES the source for totals (a grand AVERAGE averages
// all source rows, not the group averages), which the lazy groupBy verb can't do.

export class GroupByFrameNode extends ClassicPreset.Node {
  label: string;
  op: AggOp;
  totalDepth = 0;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "" };
  width = 200; height = 205;

  constructor(init?: { label?: string; op?: AggOp; totalDepth?: number }) {
    super("GroupByFrame");
    this.label = init?.label ?? "Group By";
    this.op = init?.op ?? "sum";
    this.totalDepth = init?.totalDepth ?? 0;
    this.addInput("frame", frameIn("Frame"));
    this.addInput("keys", strListIn("Group by"));
    this.addInput("column", strIn("Aggregate"));
    this.addOutput("frame", frameOut("Grouped"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; keys?: string[][]; column?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    const keys = inputs.keys?.[0] ?? [];
    const col = (inputs.column?.[0] ?? this.stringLiterals.column ?? "").trim();
    if (f == null) return emitFrame(this, beginPass(this), null);
    if (!(keys.length && col)) return emitFrame(this, beginPass(this), await readFrame(f));
    // Totals need the source (not the grouped output) to re-aggregate, so this
    // path is EAGER — materialize here and pivot, instead of extending the lazy
    // plan. Acceptable: total rows are a presentation boundary anyway.
    if (this.totalDepth !== 0) {
      const mat = await readFrame(f);
      if (mat == null || isSolError(mat)) return emitFrame(this, beginPass(this), mat);
      return emitFrame(this, beginPass(this), runVerb(() => pivotFrame(mat, {
        rowFields: keys, colFields: [], values: [col], funcs: [this.op],
        rowTotalDepth: this.totalDepth,
      })));
    }
    return emitFrame(this, beginPass(this),
      await runFrameUnary(f, { kind: "groupBy", keys, aggs: [{ column: col, op: this.op, as: col }] }));
  }
}

// ─── PIVOT / UNPIVOT ───────────────────────────────────────────────────────────
// Reshape long ⟷ wide (verbs: pivotFrame / unpivotFrame). Pivot: one row per
// Index value, one column per distinct Columns value, cells aggregated. Unpivot
// (melt): keep Id columns, turn each Value column into (variable, value) rows.

// A cell's stable string key for the field-value filter — the SAME stringification
// the editor's distinct list uses, so an excluded key matches the row's cell.
function pivotCellKey(v: FrameCell): string {
  if (v == null) return "";
  if (isSolError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
// First-seen distinct keys of a column (capped — a filter checklist over thousands of
// values isn't useful, and stashing them all would bloat the node).
function distinctKeys(values: readonly FrameCell[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = pivotCellKey(v);
    if (!seen.has(k)) { seen.add(k); out.push(k); if (out.length >= 200) break; }
  }
  return out;
}

// PIVOTBY — full Excel cross-tab. Rows/Columns/Values are comma-separated column
// lists (multi-field = multi-level headers). `op` is the default aggregation; a
// per-value override lives in `funcs` (value name → op, rendered as one selector
// per value column). Totals (row/col depth), sort, relativeTo, a field-value filter
// (`filterExclude`: per field, the value keys to hide) and the optional wired `filter`
// mask all flow into `pivotFrame`, which RE-AGGREGATES the source (see PivotSpec).
export class PivotNode extends ClassicPreset.Node {
  label: string;
  op: AggOp;
  funcs: Record<string, AggOp> = {};
  rowTotalDepth = 0;
  colTotalDepth = 0;
  rowSort = 0;
  colSort = 0;
  relativeTo = 0;
  // Field-value filter: per field name, the set of value KEYS (pivotCellKey) to HIDE.
  // A field present with a non-empty list excludes those rows; combined (AND) with the
  // wired `filter` mask. Edited in the popup's Filters zone.
  filterExclude: Record<string, string[]> = {};
  cachedResult: FrameValue | SolError | null = null;
  // The upstream frame's schema + per-column distinct value keys, stashed on each
  // compute so the editor popup can show a field list + filter checklists without
  // re-fetching. Empty when unconnected.
  sourceColumns: { name: string; type: FrameColType; distinct: string[] }[] = [];
  stringLiterals: Record<string, string> = { rowFields: "", colFields: "", values: "" };
  width = 220; height = 300;

  constructor(init?: {
    label?: string; op?: AggOp; funcs?: Record<string, AggOp>;
    rowTotalDepth?: number; colTotalDepth?: number; rowSort?: number; colSort?: number; relativeTo?: number;
    filterExclude?: Record<string, string[]>;
  }) {
    super("Pivot");
    this.label = init?.label ?? "Pivot";
    this.op = init?.op ?? "sum";
    if (init?.funcs) this.funcs = { ...init.funcs };
    if (init?.filterExclude) this.filterExclude = { ...init.filterExclude };
    this.rowTotalDepth = init?.rowTotalDepth ?? 0;
    this.colTotalDepth = init?.colTotalDepth ?? 0;
    this.rowSort = init?.rowSort ?? 0;
    this.colSort = init?.colSort ?? 0;
    this.relativeTo = init?.relativeTo ?? 0;
    this.addInput("frame", frameIn("Frame"));
    this.addInput("rowFields", strListIn("Rows"));
    this.addInput("colFields", strListIn("Columns"));
    this.addInput("values", strListIn("Values"));
    this.addInput("filter", logicalListIn("Filter"));
    this.addOutput("frame", frameOut("Wide"));
  }

  data(inputs: {
    frame?: (FrameValue | null)[];
    rowFields?: string[][]; colFields?: string[][]; values?: string[][];
    filter?: (boolean | null)[][];
  }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; this.sourceColumns = []; return { frame: null }; }
    this.sourceColumns = f.columns.map((c) => ({ name: c.name, type: c.type, distinct: distinctKeys(c.values) }));
    // Flush fields the current frame no longer has (e.g. after repointing the Pivot at a
    // different source — the old "Amount" isn't a column of the new CSV). Prune the
    // resolved lists used to build the spec, and self-heal the persisted config (inline
    // literals + per-value funcs + filters) so a stale name doesn't aggregate a missing
    // column or linger in the editor after the source changes.
    const valid = new Set(f.columns.map((c) => c.name));
    this.pruneFieldsTo(valid);
    const rowFields = (inputs.rowFields?.[0] ?? []).filter((n) => valid.has(n));
    const colFields = (inputs.colFields?.[0] ?? []).filter((n) => valid.has(n));
    const values = (inputs.values?.[0] ?? []).filter((n) => valid.has(n));
    if (values.length === 0) { this.cachedResult = f; return { frame: f }; }
    const funcs = values.map((name) => this.funcs[name] ?? this.op);
    const spec: PivotSpec = {
      rowFields, colFields, values, funcs,
      rowTotalDepth: this.rowTotalDepth, colTotalDepth: this.colTotalDepth,
      rowSort: this.rowSort, colSort: this.colSort, relativeTo: this.relativeTo,
      filter: this.combineFilter(f, inputs.filter?.[0]),
    };
    // Stays EAGER (not routed through the backend): the full PIVOTBY spec — multi-field
    // rows/cols/values, per-value funcs, totals, sort, relativeTo — exceeds the engine's
    // simple pivot op, so routing it would regress desktop to the basic cross-tab. Revisit
    // if the Polars pivot grows totals/multi-field.
    this.cachedResult = runVerb(() => pivotFrame(f, spec));
    return { frame: this.cachedResult };
  }

  /** Drop every field reference to a column the frame no longer has. Rewrites the
   *  inline literal lists (Rows/Columns/Values) only when a stale name is present (so a
   *  wired field, whose literal is unused, isn't needlessly churned), and deletes stale
   *  per-value `funcs` + `filterExclude` keys. Idempotent once the config is clean. */
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

  /** The row mask fed to pivotFrame: the field-value exclude filter AND the wired
   *  logical mask. undefined when neither is active (no filtering). */
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

  async data(inputs: { frame?: (FrameInput | null)[]; idColumns?: string[][]; valueColumns?: string[][] }) {
    const f = inputs.frame?.[0] ?? null;
    const ids = inputs.idColumns?.[0] ?? [];
    const vals = inputs.valueColumns?.[0] ?? [];
    if (f == null) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), vals.length ? await runFrameUnary(f, { kind: "unpivot", idColumns: ids, valueColumns: vals }) : await readFrame(f));
  }
}

// ─── NEST / UNNEST (the flat ⟷ cube bridge) ───────────────────────────────────
// Nest: group a flat Frame by key into a Cube whose nested column holds the rest
// (verb: nestFrame). Unnest: expand a Cube's nested-frame column back to flat
// (verb: unnestCube). The only verb nodes that cross the frame ⟷ cube boundary.

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
    const keys = inputs.keys?.[0] ?? [];
    const name = (inputs.nestedName?.[0] ?? this.stringLiterals.nestedName ?? "items").trim() || "items";
    if (!f || !keys.length) { this.cachedResult = null; return { cube: null }; }
    this.cachedResult = runVerb(() => nestFrame(f, keys, name));
    return { cube: this.cachedResult };
  }
}

export class UnnestNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "" };
  width = 190; height = 150;

  constructor(init?: { label?: string }) {
    super("Unnest");
    this.label = init?.label ?? "Unnest";
    this.addInput("cube", cubeIn("Cube"));
    this.addInput("column", strIn("Nested column"));
    this.addOutput("frame", frameOut("Flat"));
  }

  data(inputs: { cube?: (CubeValue | null)[]; column?: string[] }) {
    const c = inputs.cube?.[0] ?? null;
    const col = (inputs.column?.[0] ?? this.stringLiterals.column ?? "").trim();
    if (!c || !col) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = runVerb(() => unnestCube(c, col));
    return { frame: this.cachedResult };
  }
}

// ─── APPEND ────────────────────────────────────────────────────────────────────
// Stack two Frames vertically, union by column name (verb: appendFrames). A
// conflicting column type across the two is a #TYPE!. One side alone passes
// through (so it's safe while you're still wiring the other).

export class AppendNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | SolError | null = null;
  width = 190; height = 175;

  constructor(init?: { label?: string }) {
    super("Append");
    this.label = init?.label ?? "Append";
    this.addInput("top", frameIn("Top"));
    this.addInput("bottom", frameIn("Bottom"));
    this.addOutput("frame", frameOut("Stacked"));
  }

  async data(inputs: { top?: (FrameInput | null)[]; bottom?: (FrameInput | null)[] }) {
    const frames = [inputs.top?.[0] ?? null, inputs.bottom?.[0] ?? null].filter((f): f is FrameInput => f != null);
    if (frames.length === 0) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), frames.length === 1 ? await readFrame(frames[0]) : await runFrameAppend(frames));
  }
}

// ─── RENAME COLUMNS ────────────────────────────────────────────────────────────
// Rename columns via two parallel name lists, zipped by position: From ["qty"]
// → To ["Quantity"] (verb: renameColumns). Both are typeable strlists. A name in
// From that isn't a column is ignored; a collision is de-duped (Date2…).

export class RenameNode extends ClassicPreset.Node {
  label: string;
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

  async data(inputs: { frame?: (FrameInput | null)[]; from?: string[][]; to?: string[][] }) {
    const f = inputs.frame?.[0] ?? null;
    const from = inputs.from?.[0] ?? [];
    const to = inputs.to?.[0] ?? [];
    if (f == null) return emitFrame(this, beginPass(this), null);
    const map: Record<string, string> = {};
    for (let i = 0; i < Math.min(from.length, to.length); i++) {
      if (from[i] && to[i]) map[from[i]] = to[i];
    }
    return emitFrame(this, beginPass(this), Object.keys(map).length ? await runFrameUnary(f, { kind: "rename", map }) : await readFrame(f));
  }
}

// ─── SPLIT COLUMN / ADD INDEX (Power Query column ops) ──────────────────────────

export class SplitColumnNode extends ClassicPreset.Node {
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
    this.addInput("into", strListIn("Into (names)"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { frame?: (FrameValue | null)[]; column?: string[]; delimiter?: string[]; into?: string[][] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const column = (inputs.column?.[0] ?? this.stringLiterals.column ?? "").trim();
    const delimiter = inputs.delimiter?.[0] ?? this.stringLiterals.delimiter ?? "";
    const into = inputs.into?.[0] ?? [];
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

  data(inputs: { frame?: (FrameValue | null)[]; start?: number[]; name?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const start = inputs.start?.[0] ?? this.literals.start ?? 1;
    const name = (inputs.name?.[0] ?? this.stringLiterals.name ?? "Index").trim() || "Index";
    this.cachedResult = runVerb(() => addIndexColumn(f, name, start));
    return { frame: this.cachedResult };
  }
}

// ─── DECISION MATRIX ───────────────────────────────────────────────────────────
// Weighted-scoring + ranking of a Frame's rows — a port of the jortscity Decision
// Matrix Bases View. Rows are options, number/logical columns are criteria, an
// optional leading text column names the options. Scores each option by the weighted
// average Σ(score × weight) / Σ|weight| (so a NEGATIVE weight penalises a "lower is
// better" criterion) and competition-ranks them. Weights are edited inline as one
// labeled, default-1 box per criterion (the component renders them from `criteria`);
// the `weights` socket is an optional positional override for computed weights.
// `normalize` makes incompatible scales comparable first (none / divide-by-max /
// within-column rank). Output: Option · Score · Rank, best first — chart the podium
// with Get Column "Score" → Chart. (Math + criteria detection in frameVerbs; the Raw
// Scores table stays your own Frame Input.)

export type DecisionDetail = "summary" | "breakdown";

export class DecisionMatrixNode extends ClassicPreset.Node {
  label: string;
  normalize: DecisionNormalize;
  detail: DecisionDetail;
  // Inline, name-keyed weights: criterion name → weight. This is the primary,
  // labeled, default-1 weight UI (one editable box per criterion, rendered by the
  // component from `criteria`). A wired `weights` list overrides it positionally
  // (for computed weights). Persisted as an object via extractInit.
  weightMap: Record<string, number>;
  // Per-criterion normalize OVERRIDE (criterion name → mode). Absent = inherit the
  // node default `normalize`. This is the DMBV per-column "Rank Raws": rank just the
  // $-scale columns, leave the /10 ones raw. Persisted as an object via extractInit.
  normMap: Record<string, DecisionNormalize>;
  // The detected criteria names, refreshed each compute so the component can render
  // a labeled weight box per criterion in the order the weights align to.
  criteria: string[] = [];
  cachedResult: FrameValue | SolError | null = null;
  width = 248; height = 235;

  constructor(init?: { label?: string; normalize?: DecisionNormalize; detail?: DecisionDetail; weightMap?: Record<string, number>; normMap?: Record<string, DecisionNormalize> }) {
    super("DecisionMatrix");
    this.label = init?.label ?? "Decision Matrix";
    this.normalize = init?.normalize ?? "none";
    this.detail = init?.detail ?? "summary";
    this.weightMap = init?.weightMap ? { ...init.weightMap } : {};
    this.normMap = init?.normMap ? { ...init.normMap } : {};
    this.addInput("frame", frameIn("Scores"));
    this.addInput("weights", numListIn("Weights"));
    this.addOutput("frame", frameOut("Ranking"));
  }

  data(inputs: { frame?: (FrameValue | null)[]; weights?: (number[] | number | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; this.criteria = []; return { frame: null }; }
    this.criteria = decisionCriteria(f);
    const wRaw = inputs.weights?.[0];
    const wired = Array.isArray(wRaw) ? wRaw : typeof wRaw === "number" ? [wRaw] : null;
    // Wired list wins (positional); otherwise the inline name-keyed weights, default 1.
    const weights = wired ?? this.criteria.map((name) => {
      const w = this.weightMap[name];
      return typeof w === "number" && Number.isFinite(w) ? w : 1;
    });
    this.cachedResult = runVerb(() => decisionMatrix(f, weights, this.normalize, this.detail === "breakdown", this.normMap));
    return { frame: this.cachedResult };
  }
}

// ─── DECISION SENSITIVITY ───────────────────────────────────────────────────────
// "How robust is the winner to my weights?" Score the same options under several
// weight scenarios and see whether the ranking holds. `scores` is the usual options
// frame; `scenarios` is a frame where each ROW is a scenario (first text column names
// it, a numeric column named after a criterion is that criterion's weight; missing →
// 1). Output is a CUBE — one row per scenario, Scenario · Winner · Margin · Ranking —
// where Ranking is the full Option·Score·Rank table nested in the cell (drill in via
// the cube popup). Margin (top − runner-up) flags how decisive each scenario is.

export class DecisionSensitivityNode extends ClassicPreset.Node {
  label: string;
  normalize: DecisionNormalize;
  cachedResult: CubeValue | SolError | null = null;
  width = 220; height = 240;

  constructor(init?: { label?: string; normalize?: DecisionNormalize }) {
    super("DecisionSensitivity");
    this.label = init?.label ?? "Sensitivity";
    this.normalize = init?.normalize ?? "none";
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

// ─── RECONCILE ───────────────────────────────────────────────────────────────
// Compare two versions of "the same" frame by a key column: classify each key as
// added / removed / changed / unchanged with a before/after/Δ per shared numeric
// column (verb: reconcileFrames, which reuses joinFrames' key-index machinery).
// Naming a Price and a Quantity column (both numeric, present on both sides) also
// runs the price/volume/mix variance breakdown, surfaced in the summary line.
// Not a lazy verb — a materialization boundary like Decision Matrix, so its data()
// takes plain FrameValue inputs (coerceInputs collects any upstream FrameRef).

export class ReconcileNode extends ClassicPreset.Node {
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

  data(inputs: {
    left?: (FrameValue | null)[]; right?: (FrameValue | null)[];
    key?: string[]; priceColumn?: string[]; qtyColumn?: string[];
  }) {
    const left = inputs.left?.[0] ?? null;
    const right = inputs.right?.[0] ?? null;
    const key = (inputs.key?.[0] ?? this.stringLiterals.key ?? "").trim();
    const priceColumn = (inputs.priceColumn?.[0] ?? this.stringLiterals.priceColumn ?? "").trim() || undefined;
    const qtyColumn = (inputs.qtyColumn?.[0] ?? this.stringLiterals.qtyColumn ?? "").trim() || undefined;
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

// The Reconcile summary is emitted as MARKDOWN — it reads fine as plain text on the
// node's own hero box AND renders formatted when piped into a Display with a markdown
// Format Controller (bold counts, a delta paragraph). Kept terse (no headings) so it
// stays compact in a value box.
function summarizeReconcile(s: ReconcileSummary): string {
  const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString(APP_LOCALE) : n.toLocaleString(APP_LOCALE, { maximumFractionDigits: 2 }));
  const parts = [`**${s.added}** added`, `**${s.removed}** removed`, `**${s.changed}** changed`, `**${s.unchanged}** unchanged`];
  // Blank/invalid-key rows couldn't be matched — surface the count so a shrunk output
  // isn't mistaken for a clean reconciliation.
  if (s.skipped > 0) parts.push(`**${s.skipped}** skipped`);
  let out = parts.join(" · ");
  if (s.pvm) {
    const p = s.pvm;
    const sign = (n: number) => (n >= 0 ? "+" : "");
    out += `\n\n**Δ ${sign(p.delta)}${fmt(p.delta)}** — price ${sign(p.price)}${fmt(p.price)} · volume ${sign(p.volume)}${fmt(p.volume)} · mix ${sign(p.mix)}${fmt(p.mix)}`;
    // The decomposition covers only rows with clean price+qty on both present sides;
    // say so when some were dropped, so Δ isn't read as the whole-population change.
    if (p.excluded > 0) out += `\n\n_PVM excludes ${p.excluded} row${p.excluded === 1 ? "" : "s"} (blank/errored price or qty)._`;
  }
  return out;
}

// ─── BUILD FRAME ───────────────────────────────────────────────────────────────

export class BuildFrameNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | null = null;
  width = 200; height = 175;

  constructor(init?: { label?: string }) {
    super("BuildFrame");
    this.label = init?.label ?? "Build Frame";
    this.addInput("matrix", tableIn("Matrix"));
    this.addInput("headers", strListIn("Headers"));
    this.addOutput("frame", frameOut("Frame"));
  }

  // Identity-stable memoization (same pattern as FrameInputNode): a fresh
  // FrameValue every data() call defeats the backend's identity source-cache —
  // each pass re-serialized the whole matrix over engine_source (and, on web,
  // leaked the previous handle) (audit finding 42).
  private _builtFromMatrix: unknown;
  private _builtFromHeaders: unknown;

  data(inputs: { matrix?: unknown[]; headers?: string[][] }) {
    const rawMatrix = inputs.matrix?.[0];
    const headers = inputs.headers?.[0];
    if (this.cachedResult && rawMatrix === this._builtFromMatrix && headers === this._builtFromHeaders) {
      return { frame: this.cachedResult };
    }
    const m = toMatrix(rawMatrix as number | number[] | number[][] | null | undefined);
    if (!m || m.length === 0) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = buildFrame(m, headers);
    this._builtFromMatrix = rawMatrix;
    this._builtFromHeaders = headers;
    return { frame: this.cachedResult };
  }
}

// ─── SPLIT FRAME ───────────────────────────────────────────────────────────────

// The Split Frame column-type filter: keep all columns, or only those of one type.
// Filtering to a numeric-representable type (number/date/logical) lets Split pull a
// clean Matrix out of a MIXED frame — which plain "all" can't (any text column makes
// the matrix null). Text → headers only (text has no numeric matrix).
export type SplitColType = "all" | FrameColType;

// The Matrix output socket type tracks the chosen column type, so downstream type-
// gated inputs (a date-matrix op, a logical-matrix op, a string-matrix op) accept it.
// all/number → number table; date → date-serial table; logical → 1/0 table; text →
// string table (the one case whose matrix is strings, not numbers).
export function splitMatrixOutput(colType: SplitColType) {
  return colType === "string" ? strTableOut("Matrix")
    : colType === "date" ? dateTableOut("Matrix")
    : colType === "logical" ? logicalTableOut("Matrix")
    : tableOut("Matrix");
}

export class SplitFrameNode extends ClassicPreset.Node {
  label: string;
  colType: SplitColType;
  cachedMatrix: (number | string)[][] | null = null;
  cachedHeaders: string[] | null = null;
  // True when the kept columns include text, so the Matrix output is null by design —
  // lets the component explain the empty Matrix instead of a bare "—".
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
    // Keep only the columns of the chosen type (or all), then build the matrix from
    // that subset — so Matrix + Headers are both filtered consistently.
    const cols = this.colType === "all" ? f.columns : f.columns.filter((c) => c.type === this.colType);
    const headers = cols.map((c) => c.name);

    if (this.colType === "string") {
      // Text has no numeric matrix — build a STRING matrix of the text columns so the
      // strtable output is real, not null.
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
// Pull one column out of a Frame as a typed list. The "read as" choice sets the
// output socket type — Number → numeric list, Text → string list, Date → date
// list (numeric serials, typed as dates so a date column re-tags at the socket).

export type GetColumnReadAs = "number" | "text" | "date" | "logical";

/** Output port for a read-as choice. */
export function getColumnOutput(readAs: GetColumnReadAs) {
  return readAs === "text" ? strListOut("Values")
    : readAs === "date" ? dateListOut("Values")
    : readAs === "logical" ? logicalListOut("Values")
    : listOut("Values");
}

type GetColumnValues =
  | (number | null | SolError)[]
  | string[]
  | (boolean | null | SolError)[]
  | SolError
  | null;

export class GetColumnNode extends ClassicPreset.Node {
  label: string;
  readAs: GetColumnReadAs;
  cachedResult: (number | null | SolError)[] | string[] | (boolean | null | SolError)[] | null = null;
  stringLiterals: Record<string, string> = { name: "" };
  width = 200; height = 205;

  constructor(init?: { label?: string; readAs?: GetColumnReadAs }) {
    super("GetColumn");
    this.label = init?.label ?? "Get Column";
    this.readAs = init?.readAs ?? "number";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("name", strIn("Column"));
    this.addOutput("values", getColumnOutput(this.readAs));
  }

  data(inputs: { frame?: (FrameInput | null)[]; name?: string[] }): { values: GetColumnValues } {
    const f = inputs.frame?.[0] ?? null;
    const name = inputs.name?.[0] ?? this.stringLiterals.name ?? "";
    if (!f || name.trim() === "") { this.cachedResult = null; return { values: null }; }
    // A LAZY upstream (verb chain): fetch the ONE column through the backend's
    // column primitive instead of forcing a full-frame collect (audit finding
    // 24 — Get Column wasn't in LAZY_FRAME_NODES, so a 500k-row chain hauled
    // every column back to read one). The engine awaits a promise-returning
    // data(); the cast keeps the sync signature the FrameValue path (and every
    // existing test) uses.
    if (isFrameRef(f)) {
      return (async () => {
        const col = await materialize((async () => frameBackend().column(await flushRef(f), name))());
        if (isSolError(col)) { this.cachedResult = null; return { values: col }; }
        if (!col) { this.cachedResult = null; return { values: null }; }
        return { values: this.readColumn(col) };
      })() as unknown as { values: GetColumnValues };
    }
    const col = getColumn(f, name);
    if (!col) { this.cachedResult = null; return { values: null }; }
    return { values: this.readColumn(col) };
  }

  /** Apply the read-as coercion to a fetched column; stashes cachedResult. */
  private readColumn(col: FrameColumn): GetColumnValues {
    if (this.readAs === "text") {
      // Stringify each cell; a DATE column formats its serials as date strings
      // (not raw "46025"), a numeric column becomes its digits.
      const out = col.values.map((v) => {
        const c = formatFrameCell(col.type, v);
        return c == null ? "" : String(c);
      });
      this.cachedResult = out;
      return out;
    }
    if (this.readAs === "logical") {
      // The way to get a logical column OUT as a real logical list (TRUE/FALSE),
      // and to coerce a 0/1 mask or "true"/"false" text column to one. Shares
      // coerceLogical with Cast → Boolean so both parse identically: a boolean
      // passes through, a number is nonzero=TRUE, "TRUE"/"FALSE" parse. A blank
      // stays null (missing); an unparseable cell → null too (lenient, like the
      // numeric read-as's NaN — there's no boolean NaN, and a missing reads cleaner
      // than a fabricated FALSE); a per-cell error propagates.
      const out = col.values.map((v) =>
        v === null ? null : isSolError(v) ? v : coerceLogical(v),
      );
      this.cachedResult = out;
      return out;
    }
    // Number / Date are COERCIONS, not filters: a number passes through; a TEXT
    // cell is parsed (so a CSV-imported date column stored as text — "2026-01-03"
    // — reads as Date into serials, and a numeric-text column reads as Number).
    // Anything unparseable → NaN (→ N/A), the same as genuinely bad data. This is
    // element-wise Cast(date) / Cast(number) baked into the read-as choice.
    const out = col.values.map((v) => {
      if (v === null) return null; // a blank cell is MISSING — flows as null (aggregators skip it), not NaN
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0; // a logical column coerces to 1/0
      if (isSolError(v)) return v; // a per-cell error propagates (array-semantics policy)
      if (typeof v === "string") {
        return this.readAs === "date" ? parseDateToSerial(v) : Number(v.trim());
      }
      return NaN;
    });
    this.cachedResult = out;
    return out;
  }
}

// ─── ADD COLUMN ────────────────────────────────────────────────────────────────
// Append a list to a Frame as a new column. The "add as" choice sets the Values
// input socket type and the stored column type — Number/Date → numeric column
// (Date is just serials), Text → text column.

export type AddColumnAddAs = "number" | "text" | "date" | "logical";

/** Values input port for an add-as choice. */
export function addColumnInput(addAs: AddColumnAddAs) {
  return addAs === "text" ? strListIn("Values")
    : addAs === "date" ? dateListIn("Values")
    : addAs === "logical" ? logicalListIn("Values")
    : listIn("Values");
}

export class AddColumnNode extends ClassicPreset.Node {
  label: string;
  addAs: AddColumnAddAs;
  cachedResult: FrameValue | null = null;
  stringLiterals: Record<string, string> = { name: "" };
  width = 200; height = 235;

  constructor(init?: { label?: string; addAs?: AddColumnAddAs }) {
    super("AddColumn");
    this.label = init?.label ?? "Add Column";
    this.addAs = init?.addAs ?? "number";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("name", strIn("Name"));
    this.addInput("values", addColumnInput(this.addAs));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { frame?: (FrameValue | null)[]; values?: FrameCell[][]; name?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    const values = inputs.values?.[0] ?? null;
    const name = (inputs.name?.[0] ?? this.stringLiterals.name ?? "").trim() || "Col";
    if (!f || !values) { this.cachedResult = null; return { frame: null }; }
    // Pad the new column to the frame's row count so columns stay aligned. A null/
    // text/error cell in the incoming list is carried verbatim (array-semantics policy).
    const rows = Math.max(frameRowCount(f), values.length);
    const padded: FrameCell[] = Array.from({ length: rows }, (_, i) =>
      i < values.length ? values[i] : null,
    );
    this.cachedResult = addColumn(f, name, padded, this.addAs === "text" ? "string" : this.addAs === "date" ? "date" : this.addAs === "logical" ? "logical" : "number");
    return { frame: this.cachedResult };
  }
}

// ─── GET ROW ────────────────────────────────────────────────────────────────────
// Pull one row out of a Frame. A row is heterogeneous (one cell per column, mixed
// types), so the only lossless container is a Frame — Get Row outputs a 1-row Frame
// (carrying the column names + types). That's the principled mirror of Get Column,
// which leaves Frame-space because a column is homogeneous.

export class GetRowNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | null = null;
  literals: Record<string, number> = { index: 1 };
  width = 200; height = 175;

  constructor(init?: { label?: string; index?: number }) {
    super("GetRow");
    this.label = init?.label ?? "Get Row";
    if (init?.index !== undefined) this.literals.index = init.index;
    this.addInput("frame", frameIn("Frame"));
    this.addInput("index", numIn("Row"));
    this.addOutput("frame", frameOut("Row"));
  }

  data(inputs: { frame?: (FrameValue | null)[]; index?: number[] }) {
    const f = inputs.frame?.[0] ?? null;
    const idx1 = inputs.index?.[0] ?? this.literals.index ?? 1;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const i = Math.round(idx1) - 1; // 1-based row number → 0-based index
    if (i < 0 || i >= frameRowCount(f)) { this.cachedResult = null; return { frame: null }; }
    const columns: FrameColumn[] = f.columns.map((c) => ({
      ...c, values: [c.values[i] ?? null], raw: c.raw ? [c.raw[i] ?? ""] : undefined, // keep the source for the picked row
    }));
    this.cachedResult = { __frame: true, columns };
    return { frame: this.cachedResult };
  }
}

// ─── XLOOKUP (VLOOKUP / XLOOKUP over a table, cube, or widened list) ─────────────
// The universal lookup: find the row whose "In column" cell equals the Lookup
// value and return that row's "Return" cell (or the WHOLE row when Return is `*`).
// This ONE node subsumes the old list, frame, and cube lookups — XLOOKUP's two
// arrays must be aligned, and by the standing rule aligned columns belong in a
// Frame (Build Frame two lists together, or read a table), not two loose sockets.
//
// Output is `any` because the returned value's type is only known at compute — a
// scalar cell, or (Return = *) a single-row Frame/Cube; it flows on the `any`
// socket and can be Cast or Displayed downstream. A miss falls back to If-not-found
// (numeric-looking text → a number), else #N/A. `matchMode` (Exact / ≤ next smaller
// / ≥ next larger — Excel's match_mode 0/-1/1) opts into an approximate fallback on
// a numeric/date key; `searchMode` (first / last — Excel's search_mode 1/-1) picks
// which duplicate wins. (Verbs: lookupFrameCell / lookupCubeCell + the *RowIndex /
// *RowAt whole-row helpers. Materialization-boundary op — eager JS like Get Column.)

export class XLookupNode extends ClassicPreset.Node {
  label: string;
  matchMode: LookupMatchMode;
  searchMode: LookupSearchMode;
  cachedResult: CubeCell | null = null;
  stringLiterals: Record<string, string> = { lookup: "", inColumn: "", returnColumn: "", ifNotFound: "" };
  // The `cube` source is a POLYMORPHIC input: XLOOKUP branches on the runtime frame-
  // vs-cube shape, so it must arrive UNCOERCED (a plain cube socket would toCube a
  // wired Frame and strip its typed date/logical columns). See the per-input coercion
  // policy in coerceInputs.ts.
  rawInputs: ReadonlySet<string> = new Set(["frame"]);
  width = 200; height = 350;

  constructor(init?: { label?: string; matchMode?: LookupMatchMode; searchMode?: LookupSearchMode }) {
    super("XLookup");
    this.label = init?.label ?? "XLOOKUP";
    this.matchMode = init?.matchMode ?? "exact";
    this.searchMode = init?.searchMode ?? "first";
    // `cube` source socket — the lattice supremum, so it accepts a Frame OR a Cube
    // (and rejects lambdas/charts that a bare `any` would let through). Its coercion
    // is bypassed via `rawInputs` (above). A cube looks the key up in its TOP-LEVEL
    // column and returns the matched cell WHOLE; Return = * returns the whole row.
    this.addInput("frame", cubeIn("Table / Cube"));
    this.addInput("lookup", strIn("Lookup"));
    this.addInput("inColumn", strIn("In column"));
    this.addInput("returnColumn", strIn("Return"));
    this.addInput("ifNotFound", strIn("If not found"));
    this.addOutput("value", anyOut("Value"));
  }

  data(inputs: {
    frame?: unknown[]; lookup?: string[];
    inColumn?: string[]; returnColumn?: string[]; ifNotFound?: string[];
  }) {
    const raw = inputs.frame?.[0] ?? null;
    const lookup = (inputs.lookup?.[0] ?? this.stringLiterals.lookup ?? "").trim();
    const inCol = (inputs.inColumn?.[0] ?? this.stringLiterals.inColumn ?? "").trim();
    const retCol = (inputs.returnColumn?.[0] ?? this.stringLiterals.returnColumn ?? "").trim();
    const fallbackRaw = inputs.ifNotFound?.[0] ?? this.stringLiterals.ifNotFound ?? "";
    if (raw == null || inCol === "" || retCol === "" || lookup === "") { this.cachedResult = null; return { value: null }; }
    // The source socket is `any` (the only socket type that passes a Frame OR a Cube
    // through UNCOERCED — a `cube` socket would re-brand a frame, an `anytable` rejects
    // both). So guard the shape at runtime: XLOOKUP needs a 2-D table — a Frame, a Cube,
    // or a 2-D matrix (widens to a frame). A scalar or a bare 1-D list is not a lookup
    // table; reject it with a clear code instead of silently widening it to a useless
    // 1-row frame (two aligned lists → Build Frame them together first).
    const tabular = isFrameValue(raw) || isCubeValue(raw) || (Array.isArray(raw) && Array.isArray((raw as unknown[])[0]));
    if (!tabular) {
      this.cachedResult = solError("#VALUE!", "XLOOKUP needs a table or cube — Build Frame two aligned lists first");
      return { value: this.cachedResult };
    }
    const src = asLookupSource(raw)!;
    const wholeRow = retCol === "*"; // return the matched row intact, not one cell
    const result = runVerb<CubeCell>(() => {
      let cell: CubeCell | undefined;
      if (isCubeValue(src)) {
        if (wholeRow) {
          const idx = lookupCubeRowIndex(src, inCol, lookup, this.matchMode, this.searchMode);
          cell = idx < 0 ? undefined : cubeRowAt(src, idx);
        } else {
          cell = lookupCubeCell(src, inCol, retCol, lookup, this.matchMode, this.searchMode);
        }
      } else if (wholeRow) {
        const idx = lookupFrameRowIndex(src, inCol, lookup, this.matchMode, this.searchMode);
        cell = idx < 0 ? undefined : frameRowAt(src, idx);
      } else {
        cell = lookupFrameCell(src, inCol, retCol, lookup, this.matchMode, this.searchMode);
      }
      if (cell !== undefined) return cell;
      const fb = fallbackRaw.trim();
      if (fb === "") return solError("#N/A", "No row matched the lookup value");
      const num = Number(fb);
      return Number.isNaN(num) ? fb : num; // a numeric If-not-found flows as a number
    });
    this.cachedResult = result;
    return { value: result };
  }
}
