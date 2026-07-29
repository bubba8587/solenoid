import { ClassicPreset } from "rete";
import { readInput, numIn, numListIn, tableOut, strTableOut, dateTableOut, logicalTableOut, listIn, listOut, strIn, strOut, strListIn, strListOut, dateListIn, dateListOut, logicalListIn, logicalListOut, frameIn, frameOut, cubeIn, cubeOut, anyIn, staticTrueAnyOut, adoptiveTableIn, adoptiveListIn, lambdaIn } from "./shared";
import { extractVariables, compileEvaluator, type ExprEvaluator } from "../excelFormula";
import { isLambdaValue } from "../lambdaValue";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { readFilterValue } from "./list";
import { toAnyMatrix } from "./coerce";
import { SolenoidSocket } from "../sockets";
import { parseDateToSerial } from "./date";
import { isSolError, solError, type SolError } from "../errorValue";
import { coerceLogical } from "../valueKinds";
import { APP_LOCALE } from "../locale";
import {
  buildFrame, buildFrameTyped, typedColumn, colTypeForSocket,
  splitFrame, getColumn, addColumn, frameRowCount, frameHasTextColumns, makeHeaders,
  frameFromInputText, formatFrameCell, isCubeValue, isFrameValue, inferColumn,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "../frame";
import {
  pivotFrame, nestFrame, unnestCube,
  splitColumn, addIndexColumn, decisionMatrix, decisionCriteria, decisionSensitivity,
  fillBlanks, replaceValues, mergeColumns, promoteHeaders, demoteHeaders, dropBlankRows, sliceRows, borderedGridFromFrame,
  lookupFrameCell, lookupCubeCell, lookupFrameRowIndex, lookupCubeRowIndex,
  frameRowAt, cubeRowAt, asLookupSource, reconcileFrames,
  filterRowsMulti, VALUELESS_FILTER_OPS, ERROR_FILTER_OPS,
  type FilterCond, type FilterCombine, type JoinHow, type AsofDirection, type AggOp, type DecisionNormalize, type LookupMatchMode, type LookupSearchMode, type ReconcileSummary,
} from "../frameVerbs";
import { pairIdsFromKeys } from "./logic";
import type { PivotSpec, FilterCondConfig } from "../frameVerbs";
import { runFrameUnary, runFrameJoin, runFrameAppend, readFrame, collectPreview, dropFrameRef, isFrameRef, frameBackend, materialize, flushRef, type FrameInput, type FrameRef } from "../frameBackend";
import type { CubeValue, CubeCell } from "../frame";
import { type UnitCell } from "../unitValue";
import { tagFrameCellUnit } from "../unitColumn";

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

export type HeadOp = "first" | "last" | "skip" | "range";

export const HEAD_OP_META: Record<HeadOp, { label: string; description: string }> = {
  first: { label: "First N",      description: "Keep the first N rows." },
  last:  { label: "Last N",       description: "Keep the last N rows." },
  skip:  { label: "Skip first N", description: "Remove the first N rows, keep the rest." },
  range: { label: "Rows N–To",    description: "Keep rows N through To, 1-based inclusive." },
};

export class HeadNode extends ClassicPreset.Node {
  label: string;
  op: HeadOp;
  cachedResult: FrameValue | SolError | null = null;
  literals: Record<string, number> = { rows: 10, to: 20 };
  width = 180; height = 175;

  constructor(init?: { label?: string; op?: HeadOp }) {
    super("Head");
    this.label = init?.label ?? "Head";
    this.op = init?.op ?? "first";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("rows", numIn("Rows"));
    this.addInput("to", numIn("To"));
    this.addOutput("frame", frameOut("Head"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; rows?: number[]; to?: number[] }) {
    const f = inputs.frame?.[0] ?? null;
    const n = readInput(inputs.rows, this.literals.rows ?? 10);
    // `to` is read by the "range" op ALONE — the guard is scoped to the active op
    // (value-semantics.md), so a wired blank To must not blank a First-N slice.
    const to = this.op === "range" ? readInput(inputs.to, this.literals.to ?? n) : 0;
    const gen = beginPass(this);
    // A wired blank row count leaves the slice unknown (value-semantics.md, "Reading an input").
    if (f == null || n === null || to === null) return emitFrame(this, gen, null);
    // First-N stays a LAZY verb (the head-of-a-huge-chain case); the other row
    // slices are eager like Split Column — Power Query's Keep/Remove Rows family.
    if (this.op === "first") return emitFrame(this, gen, await runFrameUnary(f, { kind: "head", n }));
    const fv = await readFrame(f);
    return emitFrame(this, gen, fv == null || isSolError(fv) ? fv ?? null : runVerb(() => sliceRows(fv, this.op, n, to)));
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
    this.label = init?.label ?? "Frame Sort";
    this.dir = init?.dir ?? "asc";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("column", strIn("Column"));
    this.addOutput("frame", frameOut("Sorted"));
  }

  async data(inputs: { frame?: (FrameInput | null)[]; column?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    const col = readInput(inputs.column, this.stringLiterals.column ?? "");
    // A wired blank column names no column — unknown, not "not chosen yet"
    // (value-semantics.md, "Reading an input").
    if (f == null || col === null) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), col.trim() === "" ? await readFrame(f) : await runFrameUnary(f, { kind: "sort", by: col.trim(), dir: this.dir }));
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

export type { FilterCondConfig } from "../frameVerbs";

export class FilterFrameNode extends ClassicPreset.Node {
  label: string;
  combine: FilterCombine;
  /** Per-pair {op, matchCase}, keyed by the pair id (the `column${id}` suffix). */
  condConfig: Record<string, FilterCondConfig> = {};
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["Column", "Value"];
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = {};
  // emitFrame's pass-guard fields (stamped structurally on every verb node) —
  // declared here because the Dropped ref lifecycle below reads them directly.
  _gen?: number;
  _ref?: FrameRef | null;
  /** The Dropped output's owned ref — same lifecycle as _ref, no preview. */
  _refDropped?: FrameRef | null;
  width = 210; height = 240;

  constructor(init?: {
    label?: string; combine?: FilterCombine;
    condConfig?: Record<string, FilterCondConfig>; valueKeys?: string[];
  }) {
    super("FilterFrame");
    this.label = init?.label ?? "Frame Filter";
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
    // The complement, permanently — same fixed-socket rule as the list Filter's
    // Dropped (never a mode). A lazy ref: costs nothing until a consumer
    // collects it, so the always-on second output is free.
    this.addOutput("dropped", frameOut("Dropped"));
  }

  private addPairWithId(id: number): void {
    this.addInput(`column${id}`, strIn(`Column ${id + 1}`));
    // `any` (scalar): a wired Slider/Number/Date/Boolean threshold connects;
    // unwired, the typed text field is the literal (parsed per the column type).
    this.addInput(`value${id}`, anyIn(`Value ${id + 1}`));
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

  /** emitFrame's stale-pass + previous-ref lifecycle for the secondary output,
   *  minus the preview — the card never materializes Dropped; it stays a lazy
   *  ref until a consumer collects it. */
  private publishDropped(gen: number, out: FrameRef | FrameValue | SolError | null): FrameRef | FrameValue | SolError | null {
    if (gen !== this._gen) {
      if (isFrameRef(out) && out !== this._refDropped) dropFrameRef(out);
      return null;
    }
    if (this._refDropped && this._refDropped !== out) dropFrameRef(this._refDropped);
    this._refDropped = isFrameRef(out) ? out : null;
    return out;
  }

  async data(inputs: { frame?: (FrameInput | null)[]; [k: string]: unknown[] | undefined }) {
    const f = inputs.frame?.[0] ?? null;
    const gen = beginPass(this);
    if (f == null) return { ...(await emitFrame(this, gen, null)), dropped: this.publishDropped(gen, null) };
    const conditions: FilterCond[] = [];
    for (const [colKey, valKey] of this.valuePairKeys()) {
      const id = colKey.slice(6);
      const colRaw = readInput(inputs[colKey] as string[] | undefined, this.stringLiterals[colKey] ?? "");
      const cfg = this.condConfig[id];
      const op = cfg?.op ?? "gt";
      const val = readFilterValue(inputs[valKey], this.stringLiterals[valKey]);
      const valueless = VALUELESS_FILTER_OPS.has(op); // no value to write (blank / error predicates)
      // A WIRED blank column or comparison value makes this condition unevaluable, so
      // which rows survive is unknown — the whole frame is blank, not the unfiltered
      // input (value-semantics.md, "Reading an input"). An EMPTY literal still means
      // "not written yet" and skips the condition.
      if (colRaw === null || (!valueless && val === null)) {
        return { ...(await emitFrame(this, gen, null)), dropped: this.publishDropped(gen, null) };
      }
      const col = String(colRaw).trim();
      if (col === "" || (!valueless && val!.trim() === "")) continue;
      conditions.push({ column: col, op, value: val as FrameCell, matchCase: cfg?.matchCase ?? false });
    }
    if (conditions.length === 0) {
      // Pass-through ("not written yet"): Kept = everything, Dropped = blank.
      return { ...(await emitFrame(this, gen, await readFrame(f))), dropped: this.publishDropped(gen, null) };
    }
    // An error predicate (iserror/noterror) must run in the JS ORACLE: the native
    // Polars engine degrades a per-cell error to null on upload, so it couldn't tell
    // an error from a blank. Materialize the input (errors intact for a source frame)
    // and split it here — the oracle is the same reference impl the plan matches, so
    // any comparison rows in the same filter behave identically.
    if (conditions.some((c) => ERROR_FILTER_OPS.has(c.op))) {
      const mat = await readFrame(f);
      if (mat == null || isSolError(mat)) {
        return { ...(await emitFrame(this, gen, mat ?? null)), dropped: this.publishDropped(gen, null) };
      }
      const keptF = filterRowsMulti(mat, this.combine, conditions);
      const droppedF = filterRowsMulti(mat, this.combine, conditions, true);
      return { ...(await emitFrame(this, gen, keptF)), dropped: this.publishDropped(gen, droppedF) };
    }
    // Two independent lazy refs off the same input: the kept filter and its ROW
    // complement (null-predicate rows land in Dropped, not lost — see D15).
    const kept = await runFrameUnary(f, { kind: "filterMulti", combine: this.combine, conditions });
    const dropped = await runFrameUnary(f, { kind: "filterMulti", combine: this.combine, conditions, complement: true });
    return { ...(await emitFrame(this, gen, kept)), dropped: this.publishDropped(gen, dropped) };
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
    const lkRaw = readInput(inputs.leftKey, this.stringLiterals.leftKey ?? "");
    const rkRaw = readInput(inputs.rightKey, this.stringLiterals.rightKey ?? "");
    // `tolerance` is the one input whose UNWIRED reading is genuinely "omitted" — no
    // literal typed, exact match. readInput separates the two cleanly: `undefined` is
    // that omission, `null` is a blank that arrived down a cable. It is read ONLY by
    // the as-of join, so the guard is scoped to that op (value-semantics.md): a wired
    // blank Tolerance must not blank an inner/left/right/outer join that ignores it.
    const tolerance = this.how === "asof" ? readInput(inputs.tolerance, this.literals.tolerance) : undefined;
    // A WIRED blank on any of the three is unknown, not omitted: an UNWIRED rightKey
    // means "same name as the left" and an UNWIRED tolerance means exact match, but a
    // blank arriving down a cable means neither (value-semantics.md, "Reading an input").
    if (lkRaw === null || rkRaw === null || tolerance === null) {
      return emitFrame(this, beginPass(this), null);
    }
    const lk = lkRaw.trim();
    const rk = rkRaw.trim() || lk;
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

// Read a wired/typeable column-name LIST slot. The empty literal already means
// something on these nodes ("no columns chosen → pass the frame through"), which is
// exactly where a swallowed wired blank hides (value-semantics.md, "Reading an
// input"): a cable delivering blank must read as UNKNOWN (null → blank output),
// never as "not chosen". Per-cell missing entries inside a wired list carry no
// column name and are dropped, not stringified to "null".
function readColumnList(wired: string[][] | undefined): string[] | null {
  const v = readInput(wired, [] as string[]);
  return v === null ? null : v.filter((c): c is string => typeof c === "string");
}

export class SelectColumnsNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {}; // columns: typeable strlist CSV
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
    const cols = readColumnList(inputs.columns);
    if (f == null || cols === null) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), cols.length ? await runFrameUnary(f, { kind: "select", columns: cols }) : await readFrame(f));
  }
}

export class DropColumnsNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {}; // columns: typeable strlist CSV
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
    const cols = readColumnList(inputs.columns);
    return emitFrame(this, beginPass(this), f != null && cols !== null ? await runFrameUnary(f, { kind: "drop", columns: cols }) : null);
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
    const keys = readColumnList(inputs.keys);
    const colRaw = readInput(inputs.column, this.stringLiterals.column ?? "");
    // A wired blank names no column/keys — unknown (value-semantics.md, "Reading an input").
    if (f == null || colRaw === null || keys === null) return emitFrame(this, beginPass(this), null);
    const col = colRaw.trim();
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
    const rowRaw = readColumnList(inputs.rowFields);
    const colRaw = readColumnList(inputs.colFields);
    const valRaw = readColumnList(inputs.values);
    // A wired blank field list is unknown (value-semantics.md, "Reading an input").
    if (rowRaw === null || colRaw === null || valRaw === null) { this.cachedResult = null; return { frame: null }; }
    const rowFields = rowRaw.filter((n) => valid.has(n));
    const colFields = colRaw.filter((n) => valid.has(n));
    const values = valRaw.filter((n) => valid.has(n));
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
  stringLiterals: Record<string, string> = {}; // idColumns/valueColumns: typeable strlist CSV
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
    const ids = readColumnList(inputs.idColumns);
    const vals = readColumnList(inputs.valueColumns);
    if (f == null || ids === null || vals === null) return emitFrame(this, beginPass(this), null);
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
    const keys = readColumnList(inputs.keys);
    const nameRaw = readInput(inputs.nestedName, this.stringLiterals.nestedName ?? "items");
    // A wired blank name or key list is unknown (value-semantics.md, "Reading an input").
    if (!f || keys === null || !keys.length || nameRaw === null) { this.cachedResult = null; return { cube: null }; }
    const name = nameRaw.trim() || "items";
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
    const colRaw = readInput(inputs.column, this.stringLiterals.column ?? "");
    // A wired blank names no column — unknown (value-semantics.md, "Reading an input").
    if (!c || colRaw === null || !colRaw.trim()) { this.cachedResult = null; return { frame: null }; }
    const col = colRaw.trim();
    this.cachedResult = runVerb(() => unnestCube(c, col));
    return { frame: this.cachedResult };
  }
}

// ─── APPEND ────────────────────────────────────────────────────────────────────
// The Frame rung of the append ladder (decisions.md D15): N extensible frame
// rows stacked top-to-bottom in row order, union by column NAME (verb:
// appendFrames — a column missing from one input fills blank; a conflicting
// column type is #TYPE!). One frame alone passes through (safe while you're
// still wiring the others).

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

  /** Ordered frame-row keys (insertion order = stack order). */
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

  async data(inputs: Record<string, (FrameInput | null)[] | undefined>) {
    const frames = this.valueInputKeys()
      .map((k) => inputs[k]?.[0] ?? null)
      .filter((f): f is FrameInput => f != null);
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
  stringLiterals: Record<string, string> = {}; // from/to: typeable strlist CSV
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
    // Raw reads (no per-cell filtering): `from`/`to` pair BY INDEX, so dropping a
    // cell would shift the pairing; the loop below already skips blank cells.
    const from = readInput(inputs.from, [] as string[]);
    const to = readInput(inputs.to, [] as string[]);
    if (f == null || from === null || to === null) return emitFrame(this, beginPass(this), null);
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
    const columnRaw = readInput(inputs.column, this.stringLiterals.column ?? "");
    const delimiter = readInput(inputs.delimiter, this.stringLiterals.delimiter ?? "");
    const into = readColumnList(inputs.into);
    // A wired blank column, delimiter or name list is unknown (value-semantics.md, "Reading an input").
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
    // The TWO-WAY option (author 2026-07-16): the same data indexed on BOTH axes
    // as a coordinate-bordered matrix — exactly the grid Surface / Contour /
    // Grid Interpolate read. A matrix wired in (it widens to Col1…N) gets row +
    // column indices counting from Start.
    this.addOutput("grid", tableOut("Bordered grid"));
  }

  data(inputs: { frame?: (FrameValue | null)[]; start?: number[]; name?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null, grid: null }; }
    const start = readInput(inputs.start, this.literals.start ?? 1);
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "Index");
    // A wired blank start or name is unknown (value-semantics.md, "Reading an input").
    if (start === null || nameRaw === null) { this.cachedResult = null; return { frame: null, grid: null }; }
    const name = nameRaw.trim() || "Index";
    this.cachedResult = runVerb(() => addIndexColumn(f, name, start));
    const grid = runVerb(() => borderedGridFromFrame(f, start));
    return { frame: this.cachedResult, grid };
  }
}

// ─── TIMESAVER CLEANUP VERBS (2026-07-16) ────────────────────────────────────────
// The everyday Power Query cleanup set, all eager like Split Column: Fill Down /
// Replace Values / Merge Columns / Promote Headers / Drop Blank Rows. Pure logic
// in frameVerbs.ts; each node is the thin op-picker shell.

export type FillDir = "down" | "up";

export class FillBlanksNode extends ClassicPreset.Node {
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
    this.addInput("columns", strListIn("Columns (blank = all)"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { frame?: (FrameValue | null)[]; columns?: string[][] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const colsRaw = readColumnList(inputs.columns);
    // A wired blank column list is unknown (value-semantics.md, "Reading an input").
    if (colsRaw === null) { this.cachedResult = null; return { frame: null }; }
    const columns = colsRaw.map((c) => c.trim()).filter(Boolean);
    this.cachedResult = runVerb(() => fillBlanks(f, columns, this.dir));
    return { frame: this.cachedResult };
  }
}

export type ReplaceMode = "cell" | "substring";

export class ReplaceValuesNode extends ClassicPreset.Node {
  label: string;
  mode: ReplaceMode;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { column: "", find: "", replace: "" };
  width = 200; height = 205;

  constructor(init?: { label?: string; mode?: ReplaceMode }) {
    super("ReplaceValues");
    this.label = init?.label ?? "Replace Values";
    this.mode = init?.mode ?? "cell";
    this.addInput("frame", frameIn("Frame"));
    this.addInput("column", strIn("Column (blank = all)"));
    this.addInput("find", strIn("Find"));
    this.addInput("replace", strIn("Replace"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { frame?: (FrameValue | null)[]; column?: string[]; find?: string[]; replace?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const column = readInput(inputs.column, this.stringLiterals.column ?? "");
    const find = readInput(inputs.find, this.stringLiterals.find ?? "");
    const replace = readInput(inputs.replace, this.stringLiterals.replace ?? "");
    // A wired blank is unknown, NOT the empty literal's "all columns" / "match nothing"
    // (value-semantics.md, "Reading an input").
    if (column === null || find === null || replace === null) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = runVerb(() => replaceValues(f, column, find, replace, this.mode));
    return { frame: this.cachedResult };
  }
}

export class MergeColumnsNode extends ClassicPreset.Node {
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
    this.addInput("name", strIn("Name (default Merged)"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { frame?: (FrameValue | null)[]; columns?: string[][]; separator?: string[]; name?: string[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    const colsRaw = readColumnList(inputs.columns);
    const separator = readInput(inputs.separator, this.stringLiterals.separator ?? "");
    const name = readInput(inputs.name, this.stringLiterals.name ?? "");
    // A wired blank column list, separator or name is unknown (value-semantics.md, "Reading an input").
    if (colsRaw === null || separator === null || name === null) { this.cachedResult = null; return { frame: null }; }
    const columns = colsRaw.map((c) => c.trim()).filter(Boolean);
    // No columns typed yet → pass through untouched (not an error: "not written yet").
    this.cachedResult = columns.length < 2 ? f : runVerb(() => mergeColumns(f, columns, separator, name));
    return { frame: this.cachedResult };
  }
}

export type HeaderOp = "promote" | "demote";

export const HEADER_OP_META: Record<HeaderOp, { label: string; description: string }> = {
  promote: { label: "Promote first row", description: "The first row becomes the column names. Power Query: Use First Row as Headers." },
  demote:  { label: "Demote headers", description: "Column names drop into a first row of text; columns auto-name Col1, Col2…" },
};

export class HeadersNode extends ClassicPreset.Node {
  label: string;
  op: HeaderOp;
  cachedResult: FrameValue | SolError | null = null;
  width = 200; height = 140;

  constructor(init?: { label?: string; op?: HeaderOp }) {
    super("Headers");
    this.label = init?.label ?? "Headers";
    this.op = init?.op ?? "promote";
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { frame?: (FrameValue | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = runVerb(() => (this.op === "promote" ? promoteHeaders(f) : demoteHeaders(f)));
    return { frame: this.cachedResult };
  }
}

export type BlankRowMode = "all" | "any";

export const BLANK_ROW_OP_META: Record<BlankRowMode, { label: string; description: string }> = {
  all: { label: "All cells blank", description: "Drop only fully-blank rows (spacers)." },
  any: { label: "Any cell blank",  description: "Keep only complete rows." },
};

export class DropBlankRowsNode extends ClassicPreset.Node {
  label: string;
  op: BlankRowMode;
  cachedResult: FrameValue | SolError | null = null;
  width = 190; height = 140;

  constructor(init?: { label?: string; op?: BlankRowMode }) {
    super("DropBlankRows");
    this.label = init?.label ?? "Drop Blank Rows";
    this.op = init?.op ?? "all";
    this.addInput("frame", frameIn("Frame"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { frame?: (FrameValue | null)[] }) {
    const f = inputs.frame?.[0] ?? null;
    if (!f) { this.cachedResult = null; return { frame: null }; }
    this.cachedResult = runVerb(() => dropBlankRows(f, this.op));
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
    const keyRaw = readInput(inputs.key, this.stringLiterals.key ?? "");
    const priceRaw = readInput(inputs.priceColumn, this.stringLiterals.priceColumn ?? "");
    const qtyRaw = readInput(inputs.qtyColumn, this.stringLiterals.qtyColumn ?? "");
    // A wired blank is unknown, NOT the empty literal's "don't compare this column"
    // (value-semantics.md, "Reading an input").
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
  // A one-sided (added/removed/renamed) column is a schema change the row counts can't
  // show — surface it so an all-"unchanged" result isn't mistaken for identical frames.
  if (s.addedColumns.length || s.removedColumns.length) {
    const bits = [...s.addedColumns.map((n) => `+${n}`), ...s.removedColumns.map((n) => `−${n}`)];
    out += `\n\n_Columns: ${bits.join(" · ")}._`;
  }
  if (s.pvm) {
    const p = s.pvm;
    const sign = (n: number) => (n >= 0 ? "+" : "");
    out += `\n\n**Δ ${sign(p.delta)}${fmt(p.delta)}**: price ${sign(p.price)}${fmt(p.price)} · volume ${sign(p.volume)}${fmt(p.volume)} · mix ${sign(p.mix)}${fmt(p.mix)}`;
    // The decomposition covers only rows with clean price+qty on both present sides;
    // say so when some were dropped, so Δ isn't read as the whole-population change.
    if (p.excluded > 0) out += `\n\n_PVM excludes ${p.excluded} row${p.excluded === 1 ? "" : "s"} with blank or errored price or qty._`;
  }
  return out;
}

// ─── BUILD FRAME ───────────────────────────────────────────────────────────────

export class BuildFrameNode extends ClassicPreset.Node {
  label: string;
  stringLiterals: Record<string, string> = {}; // headers: typeable strlist CSV
  cachedResult: FrameValue | null = null;
  width = 200; height = 175;

  constructor(init?: { label?: string }) {
    super("BuildFrame");
    this.label = init?.label ?? "Build Frame";
    // Adoptive matrix input: accepts a matrix of ANY element family and adopts its
    // concrete type, so a datetable → date columns (values alone can't recover a
    // date — a serial looks numeric). "Slap headers on a table → Frame"; adding
    // columns is other nodes' job (Add Column / Frame from Lists).
    this.addInput("matrix", adoptiveTableIn("Matrix"));
    this.addInput("headers", strListIn("Headers"));
    this.addOutput("frame", frameOut("Frame"));
  }

  // Identity-stable memoization (same pattern as FrameInputNode): a fresh
  // FrameValue every data() call defeats the backend's identity source-cache —
  // each pass re-serialized the whole matrix over engine_source (and, on web,
  // leaked the previous handle) (audit finding 42).
  private _builtFromMatrix: unknown;
  private _builtFromHeaders: unknown;
  private _builtFromType: unknown;

  data(inputs: { matrix?: unknown[]; headers?: string[][] }) {
    const rawMatrix = inputs.matrix?.[0];
    const headers = inputs.headers?.[0];
    // The matrix's element family, adopted onto the input socket from the wired
    // cable (settleWildcardTypes) — the only place `date` survives. Part of the
    // memo key: an adoption change (a cable retyped date↔number) must rebuild.
    const dt = this.inputs.matrix?.socket instanceof SolenoidSocket ? this.inputs.matrix.socket.dataType : undefined;
    if (this.cachedResult && rawMatrix === this._builtFromMatrix && headers === this._builtFromHeaders && dt === this._builtFromType) {
      return { frame: this.cachedResult };
    }
    const m = toAnyMatrix(rawMatrix);
    if (!m || m.length === 0) { this.cachedResult = null; return { frame: null }; }
    const known = colTypeForSocket(dt);
    // Numeric matrices keep the original builder byte-for-byte (unit headers, an
    // all-null column typed number, every existing seed/test); date/string/logical
    // and genuinely-untyped (anytable, not yet adopted) go through the typed path.
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
// The lists→Frame path: each extensible row pairs a column NAME (typed or wired)
// with a LIST of values. Each list input ADOPTS its wired list's concrete type
// (adoptiveListIn), so a datelist → a date column — the one family values can't
// recover (a serial looks numeric). Type-PRESERVING (no CSV-style re-inference of
// "1"→1); an untyped (anylist) source falls back to value inference (number/
// logical/string); mixed cells coerce to text; ragged columns pad with blanks.
// Build Frame stays the matrix+headers assembler; this one takes N typed lists —
// the path to a genuinely MIXED frame (id:number, name:string, when:date).

export class FrameFromListsNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | null = null;
  stringLiterals: Record<string, string> = {};
  literals: Record<string, number> = {};
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["Name", "Values"];
  width = 220; height = 240;

  // Identity-stable memoization (same rationale as BuildFrame, audit finding 42):
  // a fresh FrameValue per pass defeats the backend's identity source-cache.
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

  /** Ordered (nameKey, valsKey) pairs currently present, in insertion order. */
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

  data(inputs: Record<string, unknown[]>) {
    const cols: { name: string; cells: unknown[]; known: FrameColType | null }[] = [];
    const sig: unknown[] = [];
    for (const [nameK, valsK] of this.valuePairKeys()) {
      const wired = inputs[valsK]?.[0];
      if (wired === undefined || wired === null) continue; // an unwired row contributes nothing
      const cells = Array.isArray(wired) ? wired : [wired]; // a scalar makes a 1-cell column
      const nameRaw = readInput(inputs[nameK] as string[] | undefined, this.stringLiterals[nameK] ?? "");
      // A wired blank column NAME is unknown — the whole frame is blank rather than
      // one column silently auto-named (value-semantics.md, "Reading an input").
      if (nameRaw === null) { this.cachedResult = null; this._sig = []; return { frame: null }; }
      const name = String(nameRaw).trim();
      // The column type adopted onto this list input from its wired cable (date
      // survives here; null = an untyped anylist source → infer from values).
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
  | (number | UnitCell | null | SolError)[]
  | string[]
  | (boolean | null | SolError)[]
  | SolError
  | null;

export class GetColumnNode extends ClassicPreset.Node {
  label: string;
  readAs: GetColumnReadAs;
  cachedResult: (number | UnitCell | null | SolError)[] | string[] | (boolean | null | SolError)[] | null = null;
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
    const name = readInput(inputs.name, this.stringLiterals.name ?? "");
    // A wired blank names no column — unknown (value-semantics.md, "Reading an input").
    if (!f || name === null || name.trim() === "") { this.cachedResult = null; return { values: null }; }
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
    // A number column LOCKED to a dimensional unit (Bundle 05: FC A4) tags each
    // numeric cell as a base-SI UnitCell, so the unit rides OUT of the frame into
    // the list — Aggregate/arithmetic downstream carry it. Date reads never tag
    // (a serial isn't a physical quantity).
    const colUnit = this.readAs === "number" && col.unit ? col.unit : undefined;
    const out = col.values.map((v) => {
      if (v === null) return null; // a blank cell is MISSING — flows as null (aggregators skip it), not NaN
      if (typeof v === "number") return colUnit ? (tagFrameCellUnit(v, colUnit) as number | UnitCell) : v;
      if (typeof v === "boolean") return v ? 1 : 0; // a logical column coerces to 1/0
      if (isSolError(v)) return v; // a per-cell error propagates (array-semantics policy)
      if (typeof v === "string") {
        const n = this.readAs === "date" ? parseDateToSerial(v) : Number(v.trim());
        return colUnit ? (tagFrameCellUnit(n, colUnit) as number | UnitCell) : n;
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
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "");
    // A wired blank name is unknown (value-semantics.md, "Reading an input").
    if (!f || !values || nameRaw === null) { this.cachedResult = null; return { frame: null }; }
    const name = nameRaw.trim() || "Col";
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

// ─── COMPUTED COLUMN ───────────────────────────────────────────────────────────
// A row-wise formula over the frame's columns, appended (or replacing, by name)
// as a new column — Power Query's Custom Column. This node is WHY frames stay
// out of formulas (D23): the row iteration lives here, and the formula only
// ever sees scalars. Two ways to define the math (author direction 2026-07-29 —
// the frame stays pure data, the computation is a graph citizen):
//   • the inline formula (`expr`) — its variables ARE column names;
//   • a wired λ — its params bind to columns by name, so one lambda authored
//     once computes the same column on any frame (and its capture sockets
//     carry side parameters: scalars wired from anywhere in the graph).
// Per-row contract mirrors the broadcast rules: an error cell in any BOUND
// column propagates to that row's output (first in binding order); a null
// flows INTO the formula (ISBLANK/IF can see it — a formula is not an
// element-wise op); the output column's type is inferred from the computed
// cells, and a `Name (unit)` header tags the unit like Add Column.

/** One computed cell, tagged: SolErrors pass, NaN is #DOMAIN! (op-level guards
 *  inside the evaluator already classified overflow — a surviving ±Inf is a
 *  definable infinity), a non-scalar result refuses (#SHAPE! — one value per
 *  row), undefined reads as blank. */
function tagComputedCell(v: unknown): FrameCell {
  if (isSolError(v)) return v;
  if (typeof v === "number") {
    return Number.isNaN(v) ? solError("#DOMAIN!", "The result is undefined: not a number") : v;
  }
  if (typeof v === "string" || typeof v === "boolean" || v === null) return v;
  if (v === undefined) return null;
  if (Array.isArray(v)) return solError("#SHAPE!", "A computed column needs one value per row, not a list");
  return solError("#VALUE!", "A computed column needs a number, text, boolean, or blank per row");
}

/** How the computed column is typed: inferred from the computed cells, or
 *  declared (a formula over date serials can only BE a date column by saying
 *  so — inference cannot tell a serial from a number). */
export type ComputedColumnAs = "auto" | AddColumnAddAs;

/** How one variable of the row formula resolves, in precedence order: a COLUMN
 *  of that name (the row context), the `row`/`rows` builtins (1-based row
 *  number / total row count), or a SIDE INPUT — a socket the node grows for
 *  it, carrying a row-invariant value from the graph (a rate, a threshold, a
 *  whole list for SUM(...)). Columns whose names a variable can't spell — a
 *  year column "2024", "Unit Price" — are reached with the `col` accessor
 *  instead: `col("Unit Price")`, `col(2024)` — an env lambda injected per
 *  row, resolved by the evaluator's higher-order call path, so it never
 *  becomes a variable or a side socket. */
type ComputedBinding =
  | { kind: "col"; col: FrameColumn }
  | { kind: "row" }
  | { kind: "rows" }
  | { kind: "side"; value: unknown };

export class ComputedColumnNode extends ClassicPreset.Node {
  label: string;
  expr: string;
  addAs: ComputedColumnAs;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { name: "computed", after: "" };
  /** Inline defaults for the side-input sockets (Expression convention: 0). */
  literals: Record<string, number> = {};
  /** The side-input sockets currently grown (variables that named no column). */
  sideVars: string[] = [];
  width = 235; height = 290;
  private _evaluator: ExprEvaluator | null = null;
  private _vars: string[] = [];
  private _compiledFor: string | null = null;

  constructor(init?: { label?: string; expr?: string; addAs?: ComputedColumnAs; literals?: Record<string, number> }) {
    super("ComputedColumn");
    this.label = init?.label ?? "Computed Column";
    this.expr = init?.expr ?? "";
    this.addAs = init?.addAs === "number" || init?.addAs === "text" || init?.addAs === "date" || init?.addAs === "logical" ? init.addAs : "auto";
    if (init?.literals) this.literals = { ...init.literals };
    this.addInput("frame", frameIn("Frame"));
    this.addInput("name", strIn("Name"));
    // Placement: blank = append at the end; a column name = insert right
    // after it. Replacing an existing column keeps its position regardless.
    this.addInput("after", strIn("After"));
    this.addInput("fn", lambdaIn("λ"));
    this.addOutput("frame", frameOut("Frame"));
  }

  /** Grow/shrink the side-input sockets to match `needed` — like Expression's
   *  variable sockets, but driven by the FRAME SCHEMA (a variable stops being a
   *  side input the moment a column of that name appears), so it reconciles
   *  from data() via a microtask like the Expression result-rank swap. Cables
   *  on a removed socket drop; headless runs still keep the socket maps in
   *  sync so literals render and persistence sees the rows. */
  private _reconcileSideSockets(needed: string[]): void {
    const current = this.sideVars;
    const added = needed.filter((v) => !current.includes(v));
    const removed = current.filter((v) => !needed.includes(v));
    if (added.length === 0 && removed.length === 0) return;
    this.sideVars = needed;
    queueMicrotask(() => {
      void (async () => {
        for (const v of added) if (!this.inputs[v]) this.addInput(v, anyIn(v));
        const editor = getActiveEditor();
        if (editor?.getNode(this.id)) {
          const conns = editor.getConnections().filter(
            (c) => c.target === this.id && removed.includes(c.targetInput as string));
          for (const c of conns) await editor.removeConnection(c.id);
        }
        for (const v of removed) if (this.inputs[v]) this.removeInput(v);
        await getActiveArea()?.update("node", this.id);
      })();
    });
  }

  data(inputs: { frame?: (FrameValue | null)[]; name?: string[]; after?: string[]; fn?: unknown[] } & Record<string, unknown[] | undefined>) {
    const f = inputs.frame?.[0] ?? null;
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "");
    const afterRaw = readInput(inputs.after, this.stringLiterals.after ?? "");
    const lam = inputs.fn?.[0];
    const out = (frame: FrameValue | SolError | null) => { this.cachedResult = frame; return { frame }; };
    if (!f || nameRaw === null) { this._reconcileSideSockets([]); return out(null); }
    const name = nameRaw.trim() || "computed";
    const after = (afterRaw ?? "").trim();

    // The variable list: the λ's params when wired (the λ wins — it's the
    // deliberate, reusable definition), else the inline formula's variables.
    let params: string[];
    const wired = isLambdaValue(lam) ? lam : null;
    if (wired) {
      params = wired.params;
    } else {
      if (this._compiledFor !== this.expr) {
        this._evaluator = compileEvaluator(this.expr);
        this._vars = this._evaluator ? extractVariables(this.expr) : [];
        this._compiledFor = this.expr;
      }
      if (!this.expr.trim()) { this._reconcileSideSockets([]); return out(f); } // nothing defined yet
      if (!this._evaluator) { this._reconcileSideSockets([]); return out(solError("#VALUE!", "The formula does not parse")); }
      params = this._vars;
    }

    // Bind each variable: column → `row`/`rows` builtins → side input. A
    // column of the same name shadows a builtin (the user's data outranks our
    // convenience).
    const bindings: ComputedBinding[] = [];
    const side: string[] = [];
    for (const p of params) {
      const col = f.columns.find((c) => c.name === p);
      if (col) { bindings.push({ kind: "col", col }); continue; }
      if (p === "row") { bindings.push({ kind: "row" }); continue; }
      if (p === "rows") { bindings.push({ kind: "rows" }); continue; }
      if (p === "frame" || p === "name" || p === "fn" || p === "after") {
        this._reconcileSideSockets(side);
        return out(solError("#REF!", `"${p}" is a reserved input name — rename the variable or the column`));
      }
      side.push(p);
      bindings.push({ kind: "side", value: readInput(inputs[p] as (number | null)[] | undefined, this.literals[p] ?? 0) });
    }
    this._reconcileSideSockets(side);

    const rows = frameRowCount(f);
    // The `col` accessor for names a variable can't spell (a "2024" year
    // column, "Unit Price"): one env lambda reading the CURRENT row, resolved
    // by the evaluator's higher-order call path. `cursor` advances with the
    // row loop, so one closure serves every row. Exact name match only — no
    // positional fallback here, a name is a name.
    let cursor = 0;
    const colAccessor = {
      __lambda: true as const, params: ["name"], expr: "",
      fn: (nm: unknown) => {
        const key = String(nm);
        const c = f.columns.find((cc) => cc.name === key);
        return c ? (c.values[cursor] ?? null) : solError("#REF!", `No column "${key}"`);
      },
    };
    const values: FrameCell[] = [];
    for (let i = 0; i < rows; i++) {
      cursor = i;
      // Frame cells are plain values — units live on the COLUMN (D20), so
      // there is nothing to unwrap per cell. Side inputs are row-invariant.
      const cells = bindings.map((b) =>
        b.kind === "col" ? (b.col.values[i] ?? null)
        : b.kind === "row" ? i + 1
        : b.kind === "rows" ? rows
        : b.value);
      const err = cells.find((v) => isSolError(v));
      if (err) { values.push(err as SolError); continue; }
      let r: unknown;
      if (wired) {
        try { r = wired.fn(...cells); } catch (e) {
          r = isSolError(e) ? e : solError("#VALUE!", e instanceof Error ? e.message : String(e));
        }
      } else {
        const env: Record<string, unknown> = { col: colAccessor };
        params.forEach((p, k) => { env[p] = cells[k]; });
        r = this._evaluator!(env);
      }
      values.push(tagComputedCell(r));
    }
    const colType: FrameColType = this.addAs === "auto"
      ? inferColumn(name, values).type
      : this.addAs === "text" ? "string" : this.addAs;

    // Placement: a replaced column keeps its position (addColumn semantics);
    // a NEW column appends, then moves after the named anchor when one is set.
    // Replacement is detected by the column count — exact, and free of a
    // second copy of addColumn's `Name (unit)` header parsing.
    const result = addColumn(f, name, values, colType);
    const replacing = result.columns.length === f.columns.length;
    if (after && !replacing) {
      const anchorIdx = result.columns.findIndex((c) => c.name === after);
      if (anchorIdx < 0) return out(solError("#REF!", `No column "${after}" to place after`));
      const cols = [...result.columns];
      const added = cols.pop()!;
      cols.splice(anchorIdx + 1, 0, added);
      return out({ __frame: true, columns: cols });
    }
    return out(result);
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
    const idx1 = readInput(inputs.index, this.literals.index ?? 1);
    // A wired blank index picks no row — unknown (value-semantics.md, "Reading an input").
    if (!f || idx1 === null) { this.cachedResult = null; return { frame: null }; }
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
// This ONE node handles list, frame, and cube lookups — XLOOKUP's two
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
    this.addOutput("value", staticTrueAnyOut("Value"));
  }

  data(inputs: {
    frame?: unknown[]; lookup?: string[];
    inColumn?: string[]; returnColumn?: string[]; ifNotFound?: string[];
  }) {
    const raw = inputs.frame?.[0] ?? null;
    const lookupRaw = readInput(inputs.lookup, this.stringLiterals.lookup ?? "");
    const inColRaw = readInput(inputs.inColumn, this.stringLiterals.inColumn ?? "");
    const retColRaw = readInput(inputs.returnColumn, this.stringLiterals.returnColumn ?? "");
    const fallbackRaw = readInput(inputs.ifNotFound, this.stringLiterals.ifNotFound ?? "");
    // A wired blank is unknown — including ifNotFound, whose EMPTY literal means
    // "no fallback typed" (value-semantics.md, "Reading an input").
    if (lookupRaw === null || inColRaw === null || retColRaw === null || fallbackRaw === null) {
      this.cachedResult = null; return { value: null };
    }
    const lookup = lookupRaw.trim();
    const inCol = inColRaw.trim();
    const retCol = retColRaw.trim();
    if (raw == null || inCol === "" || retCol === "" || lookup === "") { this.cachedResult = null; return { value: null }; }
    // The source socket is `any` (the only socket type that passes a Frame OR a Cube
    // through UNCOERCED — a `cube` socket would re-brand a frame, an `anytable` rejects
    // both). So guard the shape at runtime: XLOOKUP needs a 2-D table — a Frame, a Cube,
    // or a 2-D matrix (widens to a frame). A scalar or a bare 1-D list is not a lookup
    // table; reject it with a clear code instead of silently widening it to a useless
    // 1-row frame (two aligned lists → Build Frame them together first).
    const tabular = isFrameValue(raw) || isCubeValue(raw) || (Array.isArray(raw) && Array.isArray((raw as unknown[])[0]));
    if (!tabular) {
      this.cachedResult = solError("#VALUE!", "XLOOKUP needs a table or cube. Build Frame two aligned lists first.");
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
