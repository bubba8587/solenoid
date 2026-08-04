import { ClassicPreset } from "rete";
import { readInput, numIn, numListIn, tableOut, strTableOut, dateTableOut, logicalTableOut, listIn, listOut, strIn, strOut, strListIn, strListOut, dateListIn, dateListOut, logicalListIn, logicalListOut, frameIn, frameOut, cubeIn, cubeOut, anyIn, anyDataIn, staticTrueAnyOut, adoptiveTableIn, adoptiveListIn, lambdaIn } from "./shared";
import { extractVariables, compileEvaluator, rowRefNames, type ExprEvaluator } from "../excelFormula";
import { isLambdaValue } from "../lambdaValue";
import { computeColumnCells } from "../computedColumnCore";
import { dropInputCables } from "../components/cablePrune";
import { getActiveArea } from "../activeGraph";
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
  frameFromInputText, parseFrameSource, frameSourceToText, deriveFrame,
  formatFrameCell, isCubeValue, isFrameValue, inferColumn,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType, type FrameSourceColumn,
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
import { tagFrameCellUnit, columnUnitFromSpec } from "../unitColumn";

// A thrown SolError must be returned as a VALUE — letting it escape data() flattens
// it to a generic #ERROR! in installErrorGuards' fromThrown.
function runVerb<T>(fn: () => T): T | SolError {
  try {
    return fn();
  } catch (e) {
    return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
  }
}

// ─── Lazy verb-node output ──────────────────────────────────────────────────────
// A passthrough (no-op verb) must emit a VALUE, not the upstream ref it doesn't own —
// callers do `readFrame(f)` for that case.
interface FrameVerbNode { _ref?: FrameRef | null; _gen?: number; cachedResult: FrameValue | SolError | null }

/** Stamp a new compute pass — the out-of-order-pass guard; MUST be evaluated BEFORE
 *  the verb's await, which the `emitFrame(this, beginPass(this), await …)` order gives. */
function beginPass(node: FrameVerbNode): number {
  node._gen = (node._gen ?? 0) + 1;
  return node._gen;
}

async function emitFrame(node: FrameVerbNode, gen: number, out: FrameRef | FrameValue | SolError | null): Promise<{ frame: FrameRef | FrameValue | SolError | null }> {
  // Stale pass: leave the node's live ref/preview alone, free the orphan handle.
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

// ─── FRAME INPUT ─────────────────────────────────────────────────────────────

export class FrameInputNode extends ClassicPreset.Node {
  label: string;
  cachedResult: FrameValue | null = null;
  frameText: string;
  /** The addable λ input keys (fn1, fn2, …); a source column with `lambda: "fn1"`
   *  computes its cells per row from the λ wired there. */
  lambdaKeys: string[] = [];
  // Return the SAME FrameValue object while the text is unchanged — a fresh one per
  // data() defeats the backend's identity source-cache (re-uploads the frame to Rust).
  private _builtFrom: string | undefined;
  width = 240; height = 220;

  constructor(init?: { label?: string; frameText?: string; lambdaKeys?: string[] }) {
    super("FrameInput");
    this.label = init?.label ?? "Frame Input";
    this.frameText = init?.frameText ?? "A, B\n1, 2\n3, 4";
    if (Array.isArray(init?.lambdaKeys)) this.lambdaKeys = init.lambdaKeys.filter((k) => typeof k === "string");
    for (const k of this.lambdaKeys) this.addInput(k, lambdaIn(`λ${k.replace(/^fn/, "")}`));
    this.addOutput("frame", frameOut("Frame"));
  }

  /** Add one λ input row (the ExtensibleInputs contract). */
  addValueInput(): string {
    const next = this.lambdaKeys.reduce((m, k) => Math.max(m, Number(k.replace(/^fn/, "")) || 0), 0) + 1;
    const key = `fn${next}`;
    this.lambdaKeys.push(key);
    this.addInput(key, lambdaIn(`λ${next}`));
    return key;
  }

  /** Remove one λ input row; columns bound to it fall back to Typed. */
  removeValueInput(key: string): void {
    this.lambdaKeys = this.lambdaKeys.filter((k) => k !== key);
    if (this.inputs[key]) this.removeInput(key);
    const source = parseFrameSource(this.frameText);
    if (source.some((c) => c.lambda === key)) {
      this.frameText = frameSourceToText(source.map((c) => (c.lambda === key ? { ...c, lambda: undefined } : c)));
    }
  }

  /** Compiled Formula-source columns, keyed by expr text; a null value = the text
   *  does not parse. */
  private _exprCache = new Map<string, { evaluator: ExprEvaluator; vars: string[] } | null>();

  /** What the last computed frame was built from — text plus each λ input's value
   *  identity, so an unchanged pass returns the SAME frame object. */
  private _computedFrom: { text: string; lams: unknown[] } | null = null;

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    const source = parseFrameSource(this.frameText);
    const isComputed = (c: FrameSourceColumn) => !!(c.lambda || c.expr);
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

    // Computed (λ / Formula) columns fill in topo order; they start EMPTIED so their
    // stale text can't feed row counts or earlier deps.
    const base = deriveFrame(source);
    const frame: FrameValue = {
      __frame: true,
      columns: base.columns.map((col, i) =>
        isComputed(source[i]) ? { name: col.name, type: "number" as FrameColType, values: [] } : col),
    };
    const nameToIdx = new Map(source.map((c, i) => [c.name, i] as const));
    const remaining = new Set(source.map((c, i) => (isComputed(c) ? i : -1)).filter((i) => i >= 0));
    const lamAt = (i: number) => {
      const v = inputs[source[i].lambda!]?.[0];
      return isLambdaValue(v) ? v : null;
    };
    const compiled = new Map<string, { evaluator: ExprEvaluator; vars: string[] } | null>();
    const exprAt = (i: number) => {
      const text = source[i].expr!;
      let entry = compiled.get(text);
      if (entry === undefined) {
        entry = this._exprCache.get(text);
        if (entry === undefined) {
          const evaluator = compileEvaluator(text);
          entry = evaluator ? { evaluator, vars: extractVariables(text) } : null;
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
        const lam = c.lambda ? lamAt(i) : null;
        const ex = !c.lambda && c.expr ? exprAt(i) : null;
        // Deps are the definition's variables AND its row-context reads (`@name`,
        // `[Name]`), so a zero-param λ still orders after the column it reads.
        const deps = lam
          ? [...lam.params, ...(lam.expr ? rowRefNames(lam.expr) : [])]
          : ex
            ? [...ex.vars, ...rowRefNames(c.expr!)]
            : [];
        if (deps.some((p) => { const d = nameToIdx.get(p); return d !== undefined && remaining.has(d); })) continue;
        remaining.delete(i);
        progress = true;
        if (c.lambda && !lam) {
          // No λ wired to the bound socket yet — the column is blank, not an error.
          fill(i, null);
          continue;
        }
        if (!c.lambda && !ex) { fill(i, solError("#VALUE!", "The formula does not parse")); continue; }
        const r = computeColumnCells(
          frame,
          lam ? { kind: "lambda", lam } : { kind: "expr", evaluator: ex!.evaluator, vars: ex!.vars },
          {
            // A variable naming no column is always a miss here — this node has no
            // side ports; a λ's side values ride its OWN captures.
            sideValue: (p, kind) => solError("#REF!", lam && kind === "var"
              ? `No column "${p}" — a table λ's side values ride its captures`
              : `No column "${p}"`),
          },
        );
        if (isSolError(r)) {
          fill(i, r);
        } else {
          // Take inferColumn's .type but keep the values verbatim — its constructed
          // column coerces cells and would mangle per-row SolErrors.
          const type = inferColumn(c.name, r.cells).type;
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
    this._builtFrom = undefined; // the literal-path cache key never matches a computed frame
    this._computedFrom = { text: this.frameText, lams };
    return { frame };
  }
}

// ─── DISTINCT ────────────────────────────────────────────────────────────────

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
    // `to` is read by the "range" op ALONE, so a wired blank To must not blank a First-N slice.
    const to = this.op === "range" ? readInput(inputs.to, this.literals.to ?? n) : 0;
    const gen = beginPass(this);
    // A wired blank row count leaves the slice unknown (value-semantics.md, "Reading an input").
    if (f == null || n === null || to === null) return emitFrame(this, gen, null);
    // First-N stays a LAZY verb (the head-of-a-huge-chain case); the other slices are eager.
    if (this.op === "first") return emitFrame(this, gen, await runFrameUnary(f, { kind: "head", n }));
    const fv = await readFrame(f);
    return emitFrame(this, gen, fv == null || isSolError(fv) ? fv ?? null : runVerb(() => sliceRows(fv, this.op, n, to)));
  }
}

// ─── SORT FRAME ────────────────────────────────────────────────────────────────

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
    // A wired blank column names no column — unknown, not "not chosen yet".
    if (f == null || col === null) return emitFrame(this, beginPass(this), null);
    return emitFrame(this, beginPass(this), col.trim() === "" ? await readFrame(f) : await runFrameUnary(f, { kind: "sort", by: col.trim(), dir: this.dir }));
  }
}

// ─── FILTER FRAME ──────────────────────────────────────────────────────────────

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
  // emitFrame's pass-guard fields, declared because the Dropped ref lifecycle reads them.
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
      // Copy only LIVE ids' config — removal keeps orphaned entries for undo, reload prunes them.
      for (const id of ids) this.addPairWithId(id);
      for (const id of ids) {
        const cfg = init?.condConfig?.[String(id)];
        if (cfg) this.condConfig[String(id)] = { ...cfg };
      }
    } else {
      this.addValuePair();
    }
    this.addOutput("frame", frameOut("Kept"));
    // The complement is a permanent socket, never a mode (same rule as the list Filter).
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
    // condConfig[id] is kept so row-removal undo restores its op/matchCase; reload prunes orphans.
  }

  /** emitFrame's stale-pass + previous-ref lifecycle for the secondary output, minus
   *  the preview — Dropped stays a lazy ref until a consumer collects it. */
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
      // A WIRED blank column/value makes the condition unevaluable → the whole frame is
      // blank, not the unfiltered input; an EMPTY literal instead skips the condition.
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
    // An error predicate must run in the JS ORACLE — the native Polars engine degrades
    // a per-cell error to null on upload and couldn't tell an error from a blank.
    if (conditions.some((c) => ERROR_FILTER_OPS.has(c.op))) {
      const mat = await readFrame(f);
      if (mat == null || isSolError(mat)) {
        return { ...(await emitFrame(this, gen, mat ?? null)), dropped: this.publishDropped(gen, null) };
      }
      const keptF = filterRowsMulti(mat, this.combine, conditions);
      const droppedF = filterRowsMulti(mat, this.combine, conditions, true);
      return { ...(await emitFrame(this, gen, keptF)), dropped: this.publishDropped(gen, droppedF) };
    }
    // Null-predicate rows land in Dropped, not lost (D15).
    const kept = await runFrameUnary(f, { kind: "filterMulti", combine: this.combine, conditions });
    const dropped = await runFrameUnary(f, { kind: "filterMulti", combine: this.combine, conditions, complement: true });
    return { ...(await emitFrame(this, gen, kept)), dropped: this.publishDropped(gen, dropped) };
  }
}

// ─── JOIN ──────────────────────────────────────────────────────────────────────

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
    // `tolerance` is read ONLY by the as-of join, so a wired blank must not blank an
    // inner/left/right/outer join that ignores it (`undefined` = omitted, `null` = wired blank).
    const tolerance = this.how === "asof" ? readInput(inputs.tolerance, this.literals.tolerance) : undefined;
    // A WIRED blank is unknown, not omitted — unlike an UNWIRED rightKey ("same name as
    // the left") or an UNWIRED tolerance (exact match).
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

// Read a column-name LIST slot: a cable delivering blank reads as UNKNOWN (null), never
// as the empty literal's "no columns chosen"; missing entries inside a wired list drop.
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

// The ONE AggOp table (SSOT-1) every agg surface derives from; `pivotOnly` marks the op
// only the pivot assembly can run, excluded from the card dropdowns and search rows.
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
    // A wired blank names no column/keys — unknown, not "not chosen yet".
    if (f == null || colRaw === null || keys === null) return emitFrame(this, beginPass(this), null);
    const col = colRaw.trim();
    if (!(keys.length && col)) return emitFrame(this, beginPass(this), await readFrame(f));
    // Totals re-aggregate the SOURCE, not the grouped output, so this path is EAGER.
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

// The ONE stringification for field-value filter keys, so an excluded key matches the cell.
function pivotCellKey(v: FrameCell): string {
  if (v == null) return "";
  if (isSolError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
// First-seen distinct keys of a column, capped so the stash doesn't bloat the node.
function distinctKeys(values: readonly FrameCell[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = pivotCellKey(v);
    if (!seen.has(k)) { seen.add(k); out.push(k); if (out.length >= 200) break; }
  }
  return out;
}

// PIVOTBY — full Excel cross-tab; every config field flows into `pivotFrame`, which
// RE-AGGREGATES the source rather than reshaping a grouped frame (see PivotSpec).
export class PivotNode extends ClassicPreset.Node {
  label: string;
  op: AggOp;
  funcs: Record<string, AggOp> = {};
  rowTotalDepth = 0;
  colTotalDepth = 0;
  rowSort = 0;
  colSort = 0;
  relativeTo = 0;
  // Per field name, the value KEYS (pivotCellKey) to HIDE; ANDed with the wired `filter` mask.
  filterExclude: Record<string, string[]> = {};
  cachedResult: FrameValue | SolError | null = null;
  // Stashed each compute so the editor popup renders its field list without re-fetching.
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
    // Flush fields the current frame no longer has, so repointing at a new source can't
    // leave a stale name aggregating a missing column or lingering in the editor.
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
    // Stays EAGER: the full PIVOTBY spec exceeds the engine's simple pivot op, so routing
    // it through the backend would regress desktop to a basic cross-tab.
    this.cachedResult = runVerb(() => pivotFrame(f, spec));
    return { frame: this.cachedResult };
  }

  /** Drop every field reference to a column the frame no longer has; idempotent, and
   *  rewrites a literal list only when a stale name is present. */
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
    // Raw reads: `from`/`to` pair BY INDEX, so dropping a cell would shift the pairing.
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
    // A wired blank is unknown, NOT the empty literal's "all columns" / "match nothing".
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

export type DecisionDetail = "summary" | "breakdown";

export class DecisionMatrixNode extends ClassicPreset.Node {
  label: string;
  normalize: DecisionNormalize;
  detail: DecisionDetail;
  // Inline weights (criterion name → weight, default 1); a wired `weights` list overrides
  // this positionally.
  weightMap: Record<string, number>;
  // Per-criterion normalize OVERRIDE; absent = inherit the node default `normalize`.
  normMap: Record<string, DecisionNormalize>;
  // Refreshed each compute, in the order the weights align to.
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
// A materialization boundary, not a lazy verb — data() takes plain FrameValue inputs.

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
    // A wired blank is unknown, NOT the empty literal's "don't compare this column".
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

// MARKDOWN, kept heading-free so it reads as plain text in a hero box and still renders
// formatted through a markdown Format Controller.
function summarizeReconcile(s: ReconcileSummary): string {
  const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString(APP_LOCALE) : n.toLocaleString(APP_LOCALE, { maximumFractionDigits: 2 }));
  const parts = [`**${s.added}** added`, `**${s.removed}** removed`, `**${s.changed}** changed`, `**${s.unchanged}** unchanged`];
  // Surface unmatchable rows so a shrunk output isn't mistaken for a clean reconciliation.
  if (s.skipped > 0) parts.push(`**${s.skipped}** skipped`);
  let out = parts.join(" · ");
  // Surface one-sided columns so an all-"unchanged" result isn't read as identical frames.
  if (s.addedColumns.length || s.removedColumns.length) {
    const bits = [...s.addedColumns.map((n) => `+${n}`), ...s.removedColumns.map((n) => `−${n}`)];
    out += `\n\n_Columns: ${bits.join(" · ")}._`;
  }
  if (s.pvm) {
    const p = s.pvm;
    const sign = (n: number) => (n >= 0 ? "+" : "");
    out += `\n\n**Δ ${sign(p.delta)}${fmt(p.delta)}**: price ${sign(p.price)}${fmt(p.price)} · volume ${sign(p.volume)}${fmt(p.volume)} · mix ${sign(p.mix)}${fmt(p.mix)}`;
    // Say when rows were dropped, so Δ isn't read as the whole-population change.
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
    // Adoptive so a datetable yields date columns — values alone can't recover a date.
    this.addInput("matrix", adoptiveTableIn("Matrix"));
    this.addInput("headers", strListIn("Headers"));
    this.addOutput("frame", frameOut("Frame"));
  }

  // Identity-stable memo: a fresh FrameValue per data() defeats the backend's source-cache.
  private _builtFromMatrix: unknown;
  private _builtFromHeaders: unknown;
  private _builtFromType: unknown;

  data(inputs: { matrix?: unknown[]; headers?: string[][] }) {
    const rawMatrix = inputs.matrix?.[0];
    const headers = inputs.headers?.[0];
    // The adopted element family — the only place `date` survives; part of the memo key,
    // since a cable retyped date↔number must rebuild.
    const dt = this.inputs.matrix?.socket instanceof SolenoidSocket ? this.inputs.matrix.socket.dataType : undefined;
    if (this.cachedResult && rawMatrix === this._builtFromMatrix && headers === this._builtFromHeaders && dt === this._builtFromType) {
      return { frame: this.cachedResult };
    }
    const m = toAnyMatrix(rawMatrix);
    if (!m || m.length === 0) { this.cachedResult = null; return { frame: null }; }
    const known = colTypeForSocket(dt);
    // Numeric matrices must keep the original builder byte-for-byte (unit headers, an
    // all-null column typed number); other families take the typed path.
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

  // Identity-stable memo: a fresh FrameValue per pass defeats the backend's source-cache.
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
      // A wired blank NAME blanks the whole frame rather than auto-naming one column.
      if (nameRaw === null) { this.cachedResult = null; this._sig = []; return { frame: null }; }
      const name = String(nameRaw).trim();
      // The adopted column type (date survives here); null = untyped → infer from values.
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

// Filtering to one numeric-representable type is how Split pulls a clean Matrix out of a
// MIXED frame — under "all", any text column makes the matrix null.
export type SplitColType = "all" | FrameColType;

// The Matrix output socket type tracks the chosen column type so downstream type-gated
// inputs accept it; `string` is the one case whose matrix is strings, not numbers.
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
  // True when the kept columns include text, so the Matrix output is null BY DESIGN.
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
    // Matrix + Headers must both come off the same filtered subset.
    const cols = this.colType === "all" ? f.columns : f.columns.filter((c) => c.type === this.colType);
    const headers = cols.map((c) => c.name);

    if (this.colType === "string") {
      // Text has no numeric matrix — build a STRING matrix so strtable is real, not null.
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
    // A LAZY upstream fetches the ONE column instead of forcing a full-frame collect; the
    // engine awaits a promise-returning data(), and the cast keeps the sync signature.
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
      // Format, don't String() — a DATE column must read as date text, not raw serials.
      const out = col.values.map((v) => {
        const c = formatFrameCell(col.type, v);
        return c == null ? "" : String(c);
      });
      this.cachedResult = out;
      return out;
    }
    if (this.readAs === "logical") {
      // Shares coerceLogical with Cast → Boolean so both parse identically; an
      // unparseable cell stays null (there is no boolean NaN).
      const out = col.values.map((v) =>
        v === null ? null : isSolError(v) ? v : coerceLogical(v),
      );
      this.cachedResult = out;
      return out;
    }
    // Number / Date are COERCIONS, not filters — a text cell is parsed, unparseable → NaN.
    // Only a number read tags cells with the column unit; a date serial is not a quantity.
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
    // Pad the new column to the frame's row count so columns stay aligned.
    const rows = Math.max(frameRowCount(f), values.length);
    const padded: FrameCell[] = Array.from({ length: rows }, (_, i) =>
      i < values.length ? values[i] : null,
    );
    this.cachedResult = addColumn(f, name, padded, this.addAs === "text" ? "string" : this.addAs === "date" ? "date" : this.addAs === "logical" ? "logical" : "number");
    return { frame: this.cachedResult };
  }
}

// ─── COMPUTED COLUMN ───────────────────────────────────────────────────────────

/** How the computed column is typed: inferred from the computed cells, or
 *  declared (a formula over date serials can only BE a date column by saying
 *  so — inference cannot tell a serial from a number). */
export type ComputedColumnAs = "auto" | AddColumnAddAs;

export class ComputedColumnNode extends ClassicPreset.Node {
  label: string;
  expr: string;
  addAs: ComputedColumnAs;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { name: "computed", after: "" };
  /** Inline defaults for the side-input sockets (Expression convention: 0). */
  literals: Record<string, number> = {};
  /** The side-input sockets currently grown (variables that named no column); PERSISTED
   *  and regrown in the constructor, so a saved cable finds its socket at load. */
  sideVars: string[] = [];
  /** Explicit variable → column bindings; absent = auto (by name, else a side input),
   *  present = ALWAYS a read of that column (stale target → #REF!). */
  bindings: Record<string, string> = {};
  /** Stashed each compute so the card renders the binding pickers without re-deriving. */
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
    this.addInput("frame", frameIn("Frame"));
    this.addInput("name", strIn("Name"));
    // Blank = append; a column name = insert after it. A replaced column keeps its position.
    this.addInput("after", strIn("After"));
    this.addInput("fn", lambdaIn("λ"));
    this.addOutput("frame", frameOut("Frame"));
  }

  /** Grow/shrink the side-input sockets to match `needed`; driven by the FRAME SCHEMA, so
   *  it must reconcile from data() via a microtask, and cables on a removed socket drop. */
  private _reconcileSideSockets(needed: string[]): void {
    const current = this.sideVars;
    const added = needed.filter((v) => !current.includes(v));
    const removed = current.filter((v) => !needed.includes(v));
    if (added.length === 0 && removed.length === 0) return;
    this.sideVars = needed;
    queueMicrotask(() => {
      void (async () => {
        // anydata (rank ≤ 2) so a side value can be a whole list, not just a scalar.
        for (const v of added) if (!this.inputs[v]) this.addInput(v, anyDataIn(v));
        await dropInputCables(this.id, removed); // SSOT-9: prune before removeInput
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
    this.sourceColumns = f ? f.columns.map((c) => c.name) : [];
    if (!f || nameRaw === null) { this.defVars = []; this._reconcileSideSockets([]); return out(null); }
    const name = nameRaw.trim() || "computed";
    const after = (afterRaw ?? "").trim();

    // A wired λ WINS over the inline formula.
    const wired = isLambdaValue(lam) ? lam : null;
    if (!wired) {
      if (this._compiledFor !== this.expr) {
        this._evaluator = compileEvaluator(this.expr);
        this._vars = this._evaluator ? extractVariables(this.expr) : [];
        this._rowRefs = this._evaluator ? rowRefNames(this.expr) : [];
        this._compiledFor = this.expr;
      }
      if (!this.expr.trim()) { this.defVars = []; this._reconcileSideSockets([]); return out(f); } // nothing defined yet
      if (!this._evaluator) { this.defVars = []; this._reconcileSideSockets([]); return out(solError("#VALUE!", "The formula does not parse")); }
    }

    // IDENTITY-STABLE output: an unchanged pass returns the SAME object, so the backend's
    // identity-keyed upload cache holds across full recomputes.
    const sideVals = this.sideVars.map((p) => readInput(inputs[p] as (number | null)[] | undefined, this.literals[p] ?? 0));
    const bindJson = JSON.stringify(this.bindings);
    const k = this._lastKey;
    if (
      this.cachedResult && !isSolError(this.cachedResult) && k &&
      Object.is(k.f, f) && Object.is(k.lam, wired) && k.expr === this.expr && k.addAs === this.addAs &&
      k.name === name && k.after === after && k.bindings === bindJson &&
      k.sideVals.length === sideVals.length && k.sideVals.every((v, i) => Object.is(v, sideVals[i]))
    ) {
      return { frame: this.cachedResult };
    }
    const remember = (frame: FrameValue) => {
      this._lastKey = { f, lam: wired, expr: this.expr, addAs: this.addAs, name, after, bindings: bindJson, sideVals };
      return out(frame);
    };

    // The per-row rules live in the SHARED core (computedColumnCore.ts); this node only
    // supplies its ports, so it can never disagree with Frame Input's column sources.
    this.defVars = wired ? wired.params : this._vars;
    const computed = computeColumnCells(
      f,
      wired ? { kind: "lambda", lam: wired } : { kind: "expr", evaluator: this._evaluator!, vars: this._vars },
      {
        reserved: ["frame", "name", "fn", "after"],
        sideValue: (p) => readInput(inputs[p] as (number | null)[] | undefined, this.literals[p] ?? 0),
        alias: this.bindings,
        // @names matching no column grow side ports — EXCEPT a wired λ's captured names,
        // which ride the Lambda card's own sockets.
        rowRefs: wired
          ? (wired.expr ? rowRefNames(wired.expr).filter((p) => !(wired.captured ?? []).includes(p)) : [])
          : this._rowRefs,
      },
    );
    if (isSolError(computed)) { this._reconcileSideSockets([]); return out(computed); }
    this._reconcileSideSockets(computed.sideVars);
    const values = computed.cells;
    const colType: FrameColType = this.addAs === "auto"
      ? inferColumn(name, values).type
      : this.addAs === "text" ? "string" : this.addAs;

    // Replacement is detected by the column COUNT — exact, and avoids a second copy of
    // addColumn's `Name (unit)` header parsing.
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

  /** What the last successful frame was built from (identity memo). */
  private _lastKey: {
    f: FrameValue; lam: unknown; expr: string; addAs: ComputedColumnAs;
    name: string; after: string; bindings: string; sideVals: unknown[];
  } | null = null;
}

// ─── GET ROW ────────────────────────────────────────────────────────────────────

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

export class XLookupNode extends ClassicPreset.Node {
  label: string;
  matchMode: LookupMatchMode;
  searchMode: LookupSearchMode;
  cachedResult: CubeCell | null = null;
  stringLiterals: Record<string, string> = { lookup: "", inColumn: "", returnColumn: "", ifNotFound: "" };
  // The source is POLYMORPHIC and must arrive UNCOERCED — coercion would toCube a wired
  // Frame and strip its typed date/logical columns.
  rawInputs: ReadonlySet<string> = new Set(["frame"]);
  width = 200; height = 350;

  constructor(init?: { label?: string; matchMode?: LookupMatchMode; searchMode?: LookupSearchMode }) {
    super("XLookup");
    this.label = init?.label ?? "XLOOKUP";
    this.matchMode = init?.matchMode ?? "exact";
    this.searchMode = init?.searchMode ?? "first";
    // `cube` is the lattice supremum: accepts a Frame OR a Cube, rejects the lambdas and
    // charts a bare `any` would let through.
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
    // A wired blank is unknown — including ifNotFound, whose EMPTY literal means "no fallback".
    if (lookupRaw === null || inColRaw === null || retColRaw === null || fallbackRaw === null) {
      this.cachedResult = null; return { value: null };
    }
    const lookup = lookupRaw.trim();
    const inCol = inColRaw.trim();
    const retCol = retColRaw.trim();
    if (raw == null || inCol === "" || retCol === "" || lookup === "") { this.cachedResult = null; return { value: null }; }
    // The uncoerced source needs a runtime shape guard: a scalar or bare 1-D list must be
    // rejected, not silently widened to a useless 1-row frame.
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
