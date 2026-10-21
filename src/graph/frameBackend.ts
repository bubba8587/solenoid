// [[C130]] rustCore, [[D98]] wholeColumnFallback, [[C24]] arraySemantics
import type { FormatAnnotation } from "./formatAnnotationStore";
import {
  getColumn, frameRowCount,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "./frame";
import { applyVerb, withUnitScales, joinFrames, joinKeyTransform, appendFrames, bindColumns, sampleFrame, aggUnitPlan, readingScaleOf, linearScaleOf, PCT_CHANGE_FROM_ZERO, ZERO_GROUP_TOTAL, type FrameOp, type JoinOpts, type AggOp, type PivotSpec } from "./frameVerbs";
import { READINGS_ADD, READINGS_SCALE, type ColumnUnit } from "./unitValue";
import { setPivotLayout, type PivotLayout } from "./pivotLayout";
import type { LambdaValue } from "./lambdaValue";
import { coreValue, errorRef, errorFromCore, wellFormed, engineClock, wasmEngineOn, syncExternalNames, readReply } from "./coreValues";
export { engineClock, wasmEngineOn, evaluateOnCore, type EngineClock } from "./coreValues";
import { solError, isSolError, type SolError, type SolErrorCode } from "./errorValue";
import { guardFinite, DOMAIN_MESSAGE, OVERFLOW_MESSAGE } from "./valueKinds";
import { engineAvailable, enginePing, ipcInvoke } from "./ipcBridge";
import { loadWasmEngine, wasmEngineLoaded, wasmInvoke, wasmInvokeSync, wasmSourceBin, wasmReadBin, type BinaryCells } from "./engineWasm";
import { calcModeStore } from "./calcModeStore";
import { pushNotice } from "./noticeStore";
import { settingsStore } from "./settingsStore";

export type FrameHandle = string & { readonly __frameHandle: unique symbol };

export interface FrameRef {
  readonly __frameRef: FrameHandle;
  readonly __plan: readonly FrameOp[];
}
export function isFrameRef(v: unknown): v is FrameRef {
  return typeof v === "object" && v !== null && "__frameRef" in v;
}
function wrapRef(h: FrameHandle): FrameRef { return { __frameRef: h, __plan: [] }; }
function extendRef(ref: FrameRef, op: FrameOp): FrameRef {
  return { __frameRef: ref.__frameRef, __plan: [...ref.__plan, op] };
}

export type FrameInput = FrameValue | FrameRef;

let _flushMemo = new Map<FrameRef, Promise<FrameHandle>>();
let _collectMemo = new Map<FrameRef, Promise<FrameValue | SolError | null>>();
let _flushedPlans = new Map<FrameHandle, { plan: readonly FrameOp[]; p: Promise<FrameHandle> }[]>();

export async function flushRef(ref: FrameRef): Promise<FrameHandle> {
  if (ref.__plan.length === 0) return ref.__frameRef;
  let p = _flushMemo.get(ref);
  if (!p) {
    const flushed = _flushedPlans.get(ref.__frameRef) ?? [];
    const prefix = flushed
      .filter((f) => f.plan.length < ref.__plan.length && f.plan.every((op, i) => op === ref.__plan[i]))
      .sort((a, b) => b.plan.length - a.plan.length)[0];
    const tail = prefix ? ref.__plan.slice(prefix.plan.length) : ref.__plan;
    p = prefix && !tail.some((op) => op.kind === "groupBy")
      ? prefix.p.then((h) => applyPlanWithSketchSampling(h, tail))
      : applyPlanWithSketchSampling(ref.__frameRef, ref.__plan);
    _flushMemo.set(ref, p);
    flushed.push({ plan: ref.__plan, p });
    _flushedPlans.set(ref.__frameRef, flushed);
  }
  return p;
}

async function applyPlanWithSketchSampling(baseHandle: FrameHandle, plan: readonly FrameOp[]): Promise<FrameHandle> {
  const be = frameBackend();
  const sample = await maybeSketchSample(be, baseHandle);
  const factor = _sampleFactor.get(sample.h) ?? 1;
  try {
    const outHandle = await be.applyMany(sample.h, plan);
    const lastGroupBy = [...plan].reverse().find((op): op is Extract<FrameOp, { kind: "groupBy" }> => op.kind === "groupBy");
    // Keyed off the unsampled base, so the guard's input scan survives the sampledTemp drop.
    if (lastGroupBy) {
      _aggGuardInfo.set(outHandle, {
        baseHandle,
        aggCols: new Map(lastGroupBy.aggs.map((a) => [a.as, a.column])),
      });
    } else {
      const inherited = _aggGuardInfo.get(baseHandle);
      if (inherited) _aggGuardInfo.set(outHandle, inherited);
    }
    if (factor > 1) {
      _sampleFactor.set(outHandle, factor);
      if (lastGroupBy) {
        const scaleColumns = new Set(lastGroupBy.aggs.filter((a) => SKETCH_EXTRAPOLATABLE.has(a.op)).map((a) => a.as));
        if (scaleColumns.size > 0) _sketchInfo.set(outHandle, { factor, scaleColumns });
      } else {
        const inherited = _sketchInfo.get(sample.h);
        if (inherited) _sketchInfo.set(outHandle, inherited);
      }
    }
    return outHandle;
  } finally {
    if (sample.sampledTemp) {
      be.drop(sample.sampledTemp);
      _sampleFactor.delete(sample.sampledTemp);
      _sketchInfo.delete(sample.sampledTemp);
      _aggGuardInfo.delete(sample.sampledTemp);
    }
  }
}

export function clearCollectMemo(): void {
  const be = frameBackend();
  for (const p of _flushMemo.values()) {
    p.then((h) => {
      be.drop(h);
      _sampleFactor.delete(h);
      _sketchInfo.delete(h);
      _aggGuardInfo.delete(h);
    }).catch(() => {});
  }
  _flushMemo = new Map();
  _collectMemo = new Map();
  _flushedPlans = new Map();
}

export async function readFrame(v: FrameInput | SolError | null | undefined): Promise<FrameValue | SolError | null> {
  if (v == null) return null;
  if (isSolError(v)) return v;
  if (isFrameRef(v)) {
    let p = _collectMemo.get(v);
    if (!p) {
      p = materialize((async () => {
        const handle = await flushRef(v);
        const r = await frameBackend().collect(handle);
        return isSolError(r) ? r : applyAggGuard(handle, applySketchScaling(handle, r));
      })());
      _collectMemo.set(v, p);
    }
    return p;
  }
  return v;
}

const CARD_PREVIEW_ROWS = 100;

function previewToFrame(p: FramePreview): FrameValue {
  const columns: FrameColumn[] = p.schema.map((c, i) => ({
    name: c.name, type: c.type, values: p.rows.map((r) => r[i] ?? null),
    ...(c.unit ? { unit: c.unit } : {}), ...(c.format ? { format: c.format } : {}),
  }));
  const f: FrameValue = { __frame: true, columns };
  if (p.truncated) f.__totalRows = p.rowCount;
  return f;
}

/** One column of a ref by `getColumn` rules, sketch-scaled and aggregate-guarded as a collect is. */
export async function readRefColumn(ref: FrameRef, name: string): Promise<FrameColumn | null> {
  const handle = await flushRef(ref);
  const col = await frameBackend().column(handle, name);
  if (!col) return null;
  const f = await applyAggGuard(handle, applySketchScaling(handle, { __frame: true, columns: [col] }));
  return f.columns[0];
}

export async function collectPreview(out: FrameInput | SolError | null, n = CARD_PREVIEW_ROWS): Promise<FrameValue | SolError | null> {
  if (out == null) return null;
  if (isSolError(out)) return out;
  if (!isFrameRef(out)) return out;
  const handle = await flushRef(out);
  const p = await materialize((async () => frameBackend().preview(handle, n))());
  if (isSolError(p)) return p;
  if (!p.truncated) return readFrame(out);
  const f = previewToFrame(p);
  f.__ref = out;
  return applyAggGuard(handle, applySketchScaling(handle, f));
}

export interface FrameSchemaColumn {
  name: string;
  type: FrameColType;
  unit?: FrameColumn["unit"];
  format?: FrameColumn["format"];
}

export interface FramePreview {
  schema: FrameSchemaColumn[];
  rows: FrameCell[][];
  rowCount: number;
  truncated: boolean;
}

export interface FrameBackend {
  source(frame: FrameValue): Promise<FrameHandle>;
  apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle>;
  applyMany(handle: FrameHandle, ops: readonly FrameOp[]): Promise<FrameHandle>;
  join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle>;
  append(handles: readonly FrameHandle[]): Promise<FrameHandle>;
  bindColumns(handles: readonly FrameHandle[]): Promise<FrameHandle>;
  preview(handle: FrameHandle, n: number): Promise<FramePreview>;
  collect(handle: FrameHandle): Promise<FrameValue>;
  column(handle: FrameHandle, name: string): Promise<FrameColumn | null>;
  drop(handle: FrameHandle): void;
  sample(handle: FrameHandle, n: number): Promise<{ handle: FrameHandle; factor: number }>;
}

export function framePreview(frame: FrameValue, n: number): FramePreview {
  const rowCount = frameRowCount(frame);
  const take = Math.max(0, Math.min(n, rowCount));
  const rows: FrameCell[][] = [];
  for (let r = 0; r < take; r++) {
    rows.push(frame.columns.map((c) => (r < c.values.length ? c.values[r] : null)));
  }
  return {
    schema: frame.columns.map((c) => ({
      name: c.name, type: c.type, ...(c.unit ? { unit: c.unit } : {}), ...(c.format ? { format: c.format } : {}),
    })),
    rows,
    rowCount,
    truncated: rowCount > take,
  };
}

class JsFrameBackend implements FrameBackend {
  // A sourced frame is held weakly, because a strong entry would pin its own FinalizationRegistry key; derived frames stay strong.
  private store = new Map<string, FrameValue | WeakRef<FrameValue>>();
  private seq = 0;

  async source(frame: FrameValue): Promise<FrameHandle> {
    const id = `jsf:${++this.seq}` as FrameHandle;
    this.store.set(id, typeof WeakRef !== "undefined" ? new WeakRef(frame) : frame);
    return id;
  }

  async apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle> {
    return this.register(applyVerb(this.get(handle), op));
  }

  async applyMany(handle: FrameHandle, ops: readonly FrameOp[]): Promise<FrameHandle> {
    let frame = this.get(handle);
    for (const op of ops) frame = applyVerb(frame, op);
    return this.register(frame);
  }

  async join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle> {
    return this.register(joinFrames(this.get(left), this.get(right), opts));
  }

  async append(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    return this.register(appendFrames(handles.map((h) => this.get(h))));
  }

  async bindColumns(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    return this.register(bindColumns(handles.map((h) => this.get(h))));
  }

  private register(frame: FrameValue): FrameHandle {
    const id = `jsf:${++this.seq}` as FrameHandle;
    this.store.set(id, frame);
    return id;
  }

  async preview(handle: FrameHandle, n: number): Promise<FramePreview> {
    return framePreview(this.get(handle), n);
  }

  async collect(handle: FrameHandle): Promise<FrameValue> {
    return this.get(handle);
  }

  async column(handle: FrameHandle, name: string): Promise<FrameColumn | null> {
    return getColumn(this.get(handle), name);
  }

  drop(handle: FrameHandle): void {
    this.store.delete(handle);
  }

  async sample(handle: FrameHandle, n: number): Promise<{ handle: FrameHandle; factor: number }> {
    const f = this.get(handle);
    const total = frameRowCount(f);
    const sampled = sampleFrame(f, n);
    const sampledRows = frameRowCount(sampled);
    if (sampledRows >= total) return { handle, factor: 1 };
    return { handle: this.register(sampled), factor: total / sampledRows };
  }

  private get(handle: FrameHandle): FrameValue {
    const e = this.store.get(handle);
    const f = e instanceof WeakRef ? e.deref() : e;
    if (!f) throw solError("#REF!", `frame handle ${handle} not found (dropped or never created)`);
    return f;
  }
}

// IPC argument names must match the Rust command parameters in engine.rs.
type WireCell = unknown;


function encodeWireCell(v: unknown): WireCell {
  if (typeof v === "number" && !Number.isFinite(v)) {
    return { __nf: Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf" };
  }
  if (isSolError(v)) { const ref = errorRef(v); return ref === undefined ? { __err: v.code } : { __err: v.code, ref }; }
  return v;
}

/** The engine names why a cell is an error (`why`, engine.rs `num_to_json`); the message is the oracle's. */
const ENGINE_ERROR_WHY: Readonly<Record<string, string>> = {
  domain: DOMAIN_MESSAGE,
  overflow: OVERFLOW_MESSAGE,
  pct_change_from_zero: PCT_CHANGE_FROM_ZERO,
  zero_total: ZERO_GROUP_TOTAL,
  readings_add: READINGS_ADD,
  readings_scale: READINGS_SCALE,
};

function decodeWireCell(v: WireCell): unknown {
  if (v && typeof v === "object") {
    const o = v as { __nf?: string; __err?: string; why?: string; msg?: string; ref?: number };
    if (o.__nf === "inf") return Infinity;
    if (o.__nf === "-inf") return -Infinity;
    if (o.__nf === "nan") return NaN;
    // The code came from this module's encoder, so the cast keeps solError's union closed.
    if (typeof o.__err === "string") {
      return errorFromCore(o.__err, o.msg || (o.why && ENGINE_ERROR_WHY[o.why]) || "from the native engine", o.ref);
    }
  }
  return v;
}

function decodeWireColumns(columns: FrameColumn[]): FrameColumn[] {
  return columns.map((c) => ({ ...c, values: c.values.map(decodeWireCell) as FrameColumn["values"] }));
}

// The columnar hand-off's tags (crates/solenoid-core/src/binary.rs).
const TAG_NULL = 0, TAG_NUM = 1, TAG_STR = 2, TAG_FALSE = 3, TAG_TRUE = 4, TAG_ERR = 5;

function encodeBinary(frame: FrameValue): BinaryCells {
  const total = frame.columns.reduce((n, c) => n + c.values.length, 0);
  const tags = new Uint8Array(total);
  const nums = new Float64Array(total);
  const parts: string[] = [];
  const lens: number[] = [];
  const text = (t: string) => { parts.push(t); lens.push(t.length); };
  let k = 0;
  for (const c of frame.columns) {
    for (const v of c.values) {
      if (typeof v === "number") { tags[k] = TAG_NUM; nums[k] = v; }
      else if (typeof v === "string") { tags[k] = TAG_STR; text(v); }
      else if (typeof v === "boolean") tags[k] = v ? TAG_TRUE : TAG_FALSE;
      else if (isSolError(v)) { tags[k] = TAG_ERR; nums[k] = errorRef(v) ?? NaN; text(v.code); text(v.message); }
      else tags[k] = TAG_NULL;
      k++;
    }
  }
  return {
    schema: frame.columns.map((c) => ({ name: c.name, type: c.type, len: c.values.length })),
    tags, nums, strs: parts.join(""), lens: Uint32Array.from(lens),
  };
}

function decodeBinary(b: BinaryCells): FrameColumn[] {
  let k = 0, off = 0, li = 0;
  const text = () => { const n = b.lens[li++]; const t = b.strs.slice(off, off + n); off += n; return t; };
  return b.schema.map((c) => {
    const values = new Array<FrameCell>(c.len);
    for (let i = 0; i < c.len; i++, k++) {
      switch (b.tags[k]) {
        case TAG_NUM: values[i] = b.nums[k]; break;
        case TAG_STR: values[i] = text(); break;
        case TAG_FALSE: values[i] = false; break;
        case TAG_TRUE: values[i] = true; break;
        case TAG_ERR: {
          const code = text(), message = text(), ref = b.nums[k];
          values[i] = errorFromCore(code, message || "from the native engine", ref);
          break;
        }
        default: values[i] = null;
      }
    }
    return { name: c.name, type: c.type as FrameColType, values };
  });
}

/** Frames crossing in bulk without JSON: the wasm engine shares memory with JS, so cells move as buffers. */
interface BulkTransport {
  source(frame: FrameValue): FrameHandle;
  read(handle: FrameHandle, column?: string, limit?: number): { columns: FrameColumn[]; rowCount: number } | null;
}

const wasmBulk: BulkTransport = {
  source: (frame) => wasmSourceBin(encodeBinary(frame)) as FrameHandle,
  read: (handle, column, limit) => {
    const b = wasmReadBin(handle, column, limit);
    return b && { columns: decodeBinary(b), rowCount: b.rowCount };
  },
};

function schemaOnly(frame: FrameValue): FrameValue {
  return { __frame: true, columns: frame.columns.map(({ raw: _raw, ...c }) => ({ ...c, values: [] })) };
}

function shadow(run: () => FrameValue): FrameValue | null {
  try { return schemaOnly(run()); } catch { return null; }
}

/** A pivot's value fields as the unit-blind engine needs them (each one's reading and linear scale), and the unit
 *  each one's body columns take: `aggUnitPlan` over the frame the pivot reads. */
function pivotUnits(schema: FrameValue, spec: PivotSpec): { scales: { readingScale?: number; unitScale?: number }[]; units: (ColumnUnit | undefined)[] } {
  const names = spec.values.filter((n) => n.trim() !== "");
  const cols = names.map((n) => schema.columns.find((c) => c.name === n));
  const funcs = names.map((_, i): AggOp => spec.funcs[i] ?? spec.funcs[0] ?? "sum");
  return {
    scales: cols.map((c) => {
      const r = readingScaleOf(c?.unit), u = linearScaleOf(c?.unit);
      return { ...(r !== undefined ? { readingScale: r } : {}), ...(u !== undefined ? { unitScale: u } : {}) };
    }),
    units: cols.map((c, v) => aggUnitPlan(funcs[v], c?.unit).unit),
  };
}

interface PivotWire { layout: unknown; units: (ColumnUnit | undefined)[] }

/** The engine's pivot layout read back onto the downloaded frame, with the units its body columns take. */
function adoptPivot(frame: FrameValue, p: PivotWire): void {
  const w = p.layout as PivotLayout | null;
  if (!w) return;
  const cells = (items: { tuple: FrameCell[] }[]) => items.map((it) => ({ ...it, tuple: it.tuple.map((x) => decodeWireCell(x) as FrameCell) }));
  const layout: PivotLayout = { ...w, rows: cells(w.rows) as PivotLayout["rows"], cols: cells(w.cols) as PivotLayout["cols"] };
  layout.cols.forEach((c, bi) => {
    const col = frame.columns[layout.rowFields.length + bi];
    const unit = p.units[c.value];
    if (col && unit) col.unit = unit;
  });
  setPivotLayout(frame, layout);
}

/** PIVOTBY on the Rust engine when it's loaded and on, synchronously; null where the oracle should run it. */
/** A pivot whose layout lists detail columns (develop's `details`, past this branch's pin): the engine's layout
 *  doesn't carry them, so the TS answers. */
const pivotNeedsOracle = (spec: object): boolean =>
  ((spec as { details?: readonly string[] }).details ?? []).some((s) => s.trim() !== "");

export function pivotOnEngine(f: FrameValue, spec: PivotSpec): FrameValue | null {
  if (!wasmEngineLoaded() || !wasmEngineOn() || pivotNeedsOracle(spec) || !crossesWhole(f)) return null;
  const { scales, units } = pivotUnits(f, spec);
  const src = wasmSourceBin(encodeBinary(f));
  let out: string | undefined;
  try {
    out = wasmInvokeSync<string>("engine_apply", { handle: src, op: { kind: "pivot", ...spec, valueScales: scales } });
    const layout = wasmInvokeSync<unknown>("engine_pivot_layout", { handle: out });
    const frame: FrameValue = { __frame: true, columns: decodeBinary(wasmReadBin(out)!) };
    adoptPivot(frame, { layout, units });
    return frame;
  } finally {
    wasmInvokeSync("engine_drop", { handle: src });
    if (out) wasmInvokeSync("engine_drop", { handle: out });
  }
}

type SideValue = (name: string, kind: "var" | "row") => unknown;

interface ColumnOpts { sideValue?: SideValue; reserved?: readonly string[]; lambdas?: Record<string, LambdaValue>; bare?: LambdaValue; alias?: Record<string, string | undefined> }

/** What `engine_compute_column` takes beside the frame: each name the formula reads that no column holds, bound as
 *  `runColumn` would, and the columns it reads. Null where the formula doesn't parse or a value can't cross. */
function columnInputs(expr: string, columns: readonly string[], opts: ColumnOpts):
  { args: Record<string, unknown>; named: Set<string> } | null {
  if (!wellFormed(expr)) return null;
  const lambdas = opts.lambdas ?? {};
  const bodies = [...Object.values(lambdas), ...(opts.bare ? [opts.bare] : [])].flatMap((l) => (l.expr ? [l.expr] : []));
  syncExternalNames();
  const names = wasmInvokeSync<{ parses: boolean; vars?: string[]; rows?: string[] }>("engine_formula_names", { src: opts.bare ? "" : expr, bodies });
  if (!names.parses) return null;
  const colSet = new Set(columns);
  const reserved = opts.reserved ?? [];
  const alias = Object.fromEntries(Object.entries(opts.alias ?? {}).filter((e): e is [string, string] => e[1] !== undefined));
  const free = (p: string) => !colSet.has(p) && !reserved.includes(p) && !(p in alias);
  const value = (p: string, kind: "var" | "row") => (p in lambdas ? lambdas[p] : opts.sideValue?.(p, kind));
  const sides: Record<string, unknown> = {};
  const rowSides: Record<string, unknown> = {};
  const vars = opts.bare ? opts.bare.params : [...names.vars!, ...Object.keys(lambdas)];
  for (const p of vars) {
    if (!free(p) || p in sides) continue;
    const w = coreValue(value(p, "var"));
    if (w === undefined) return null;
    sides[p] = w;
  }
  for (const p of names.rows!) {
    if (!free(p) || p in rowSides) continue;
    const w = coreValue(value(p, "row"));
    if (w === undefined) return null;
    rowSides[p] = w;
  }
  let bare: unknown;
  if (opts.bare) {
    bare = (coreValue(opts.bare) as { __lambda?: unknown } | undefined)?.__lambda;
    if (bare === undefined) return null;
  }
  const named = new Set([...vars, ...names.rows!, ...Object.values(alias),
    ...Object.values(lambdas).flatMap((l) => l.captured ?? []), ...(opts.bare?.captured ?? [])]);
  return {
    args: { src: opts.bare ? "" : expr, sides, rowSides, reserved, alias, lambdas: Object.keys(lambdas), clock: engineClock(), ...(opts.bare ? { bare } : {}) },
    named,
  };
}

/** A frame's string cells cross as UTF-8, where a lone surrogate would turn into U+FFFD. */
const crossesWhole = (f: FrameValue): boolean =>
  f.columns.every((c) => c.values.every((v) => typeof v !== "string" || wellFormed(v)));

type ColumnAnswer = { cells: FrameCell[]; sideVars: string[] } | SolError;

/** What `engine_compute_column` answered: the cells, the error that stopped the column, or null where a body bailed. */
function columnAnswer(r: { bail?: boolean; error?: { code: string; message: string }; handle?: string; sideVars?: string[] }, read: (h: string) => FrameCell[]):
  ColumnAnswer | null {
  if (r.bail) return null;
  if (r.error) return solError(r.error.code as SolErrorCode, r.error.message);
  return { cells: read(r.handle!), sideVars: r.sideVars! };
}



/** A frame computation no formula shares, on the core (`frame_fns.rs`, [[D99]] rustIsSpec): its frames as names, types
 *  and cells (units, formats and provenance are the caller's to carry over), and its answer as a frame or a value; what
 *  the TS throws, it throws. Null
 *  where the wasm engine is off, a value can't cross, or the core leaves the reading to the TS. */
export function frameFnOnCore(name: string, frames: readonly FrameValue[], args: readonly unknown[] = []):
  { frame: FrameValue } | { value: unknown } | null {
  if (!wasmEngineLoaded() || !wasmEngineOn() || !frames.every(crossesWhole)) return null;
  const wire = args.map(coreValue);
  if (wire.includes(undefined)) return null;
  const handles = frames.map((f) => wasmSourceBin(encodeBinary(f)));
  let out: string | undefined;
  try {
    const r = wasmInvokeSync<{ bail?: boolean; handle?: string; value?: unknown; error?: { code: string; message: string; ref?: number } }>("engine_frame_fn", { name, handles, args: wire });
    if (r.bail) return null;
    if (r.error) throw errorFromCore(r.error.code, r.error.message, r.error.ref);
    if (r.handle) {
      out = r.handle;
      return { frame: { __frame: true, columns: decodeBinary(wasmReadBin(out)!) } };
    }
    const v = readReply(r.value);
    return v && { value: v.value };
  } finally {
    for (const h of handles) wasmInvokeSync("engine_drop", { handle: h });
    if (out) wasmInvokeSync("engine_drop", { handle: out });
  }
}

/** `computeColumnCells` on the core ([[D99]] rustIsSpec): a formula, or with `bare` a wired LAMBDA called with each
 *  row's cells. Null where the wasm engine is off, a value can't cross, or a body leaves the column to the TS. */
export function computeColumnOnEngine(f: FrameValue, expr: string, rows: number, opts: ColumnOpts = {}): ColumnAnswer | null {
  if (!wasmEngineLoaded() || !wasmEngineOn()) return null;
  const inputs = columnInputs(expr, f.columns.map((c) => c.name), opts);
  if (!inputs) return null;
  const frame: FrameValue = { __frame: true, columns: f.columns.filter((c) => inputs.named.has(c.name)) };
  if (!crossesWhole(frame)) return null;
  const src = wasmSourceBin(encodeBinary(frame));
  let out: string | undefined;
  try {
    const r = wasmInvokeSync<{ bail?: boolean; error?: { code: string; message: string }; handle?: string; sideVars?: string[] }>(
      "engine_compute_column", { handle: src, rows, ...inputs.args });
    out = r.handle;
    return columnAnswer(r, (h) => decodeBinary(wasmReadBin(h)!)[0].values);
  } finally {
    wasmInvokeSync("engine_drop", { handle: src });
    if (out) wasmInvokeSync("engine_drop", { handle: out });
  }
}

/** The same over a frame already in the wasm engine: only the answer column comes back, and `col` keeps it in the
 *  engine for `assembleOnEngine`. Null where the active backend isn't the wasm engine or the formula isn't ported. */
export async function computeColumnOnRef(
  ref: FrameRef, expr: string, columns: readonly string[],
  opts: { sideValue?: SideValue; reserved?: readonly string[] } = {},
): Promise<{ cells: FrameCell[]; sideVars: string[]; base: FrameHandle; col: FrameHandle } | SolError | null> {
  const be = frameBackend();
  if (!(be instanceof EngineBackend) || !be.resident) return null;
  const inputs = columnInputs(expr, columns, opts);
  if (!inputs) return null;
  const base = await flushRef(ref);
  if (isOracleHandle(base)) return null;
  const r = await be.computeColumn(base, inputs.args);
  if (r.bail) return null;
  if (r.error) return solError(r.error.code as SolErrorCode, r.error.message);
  const col = r.handle as FrameHandle;
  const cells = (await be.column(col, "out"))?.values ?? [];
  return { cells, sideVars: r.sideVars!, base, col };
}

/** A frame built in the engine from named columns of resident frames, each renamed and typed; `schema` is its
 *  units and formats. */
export async function assembleOnEngine(
  parts: readonly { handle: FrameHandle; column: string; as: string; type: FrameColType }[], schema: FrameValue,
): Promise<FrameRef> {
  const be = frameBackend() as EngineBackend;
  return wrapRef(await be.assemble(parts, schemaOnly(schema)));
}

/** Each op against the schema it will meet, so a reading column's aggregates reach the
 *  unit-blind engine with their reading scale, and the result's schema shadow. */
/** The ops as an engine takes them, and the schema they leave. A `formats` op only touches the schema. */
export function lowerForEngine(schema: FrameValue | null, ops: readonly FrameOp[]): { wire: FrameOp[]; schema: FrameValue | null } {
  let s = schema;
  const wire: FrameOp[] = [];
  for (const op of ops) {
    if (op.kind !== "formats") wire.push(s ? (op.kind === "pivot" ? { ...op, valueScales: pivotUnits(s, op).scales } as FrameOp : withUnitScales(s, op)) : op);
    const cur = s;
    s = cur ? shadow(() => applyVerb(cur, op)) : null;
  }
  return { wire, schema: s };
}

/** A lazy node's output with its own column format picks laid over it ([[D41]] formatFlowsDownstream). */
export function refWithFormats(ref: FrameRef, formats: Record<string, FormatAnnotation>): FrameRef {
  return extendRef(ref, { kind: "formats", formats });
}

function withSchemaMeta<C extends { name: string; type: FrameColType }>(cols: C[], schema: FrameValue | null | undefined): C[] {
  if (!schema) return cols;
  const byName = new Map(schema.columns.map((c) => [c.name, c] as const));
  return cols.map((c) => {
    const s = byName.get(c.name);
    if (!s || s.type !== c.type) return c;
    return { ...c, ...(s.unit ? { unit: s.unit } : {}), ...(s.format ? { format: s.format } : {}) };
  });
}

/** The native engine keeps error cells only in number and date columns. */
const holdsTextOrLogicalError = (f: FrameValue): boolean =>
  f.columns.some((c) => (c.type === "string" || c.type === "logical") && c.values.some(isSolError));

/** A logical column has no NaN on the engine, which reads one as blank; said once a session. */
let toldLogicalNaN = false;
function noteLogicalNaN(f: FrameValue): void {
  if (toldLogicalNaN || !f.columns.some((c) => c.type === "logical" && c.values.some((v) => typeof v === "number"))) return;
  toldLogicalNaN = true;
  pushNotice("Polars reads a logical cell that isn't TRUE or FALSE as blank, where the web app shows NaN. Results that count blanks can differ.", "info");
}

const isOracleHandle = (h: FrameHandle): boolean => h.startsWith("jsf:");

/** Verbs the Rust core runs and Polars doesn't ([[C130]] rustCore). */
const RUST_CORE_ONLY: ReadonlySet<FrameOp["kind"]> = new Set(["dropBlankRows", "addIndex", "splitColumn", "mergeColumns"]);

/** An op's own cells (a filter's value) in wire form, so an error, NaN or infinity crosses as itself. */
function encodeOpCells(op: FrameOp): FrameOp {
  if (op.kind === "filter") return { ...op, value: encodeWireCell(op.value) as FrameCell };
  if (op.kind === "filterMulti") return { ...op, conditions: op.conditions.map((c) => ({ ...c, value: encodeWireCell(c.value) as FrameCell })) };
  return op;
}

type EngineInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** An engine behind handles: Polars over IPC on desktop, or the Rust engine in WebAssembly. `fullCells` says the
 *  engine stores every cell the oracle does, so no frame needs the oracle's fallback. */
class EngineBackend implements FrameBackend {
  constructor(private readonly invoke: EngineInvoke, private readonly fullCells: boolean, private readonly bulk?: BulkTransport) {}

  /** Row formulas and frame assembly run in this engine itself (the wasm one). */
  get resident(): boolean {
    return this.bulk !== undefined;
  }

  async computeColumn(handle: FrameHandle, args: Record<string, unknown>): Promise<{ bail?: boolean; error?: { code: string; message: string }; handle?: string; sideVars?: string[] }> {
    const r = await this.invoke<{ bail?: boolean; error?: { code: string; message: string }; handle?: string; sideVars?: string[] }>("engine_compute_column", { handle, ...args });
    if (r.handle) this.remember(r.handle as FrameHandle, null);
    return r;
  }

  async assemble(parts: readonly { handle: FrameHandle; column: string; as: string; type: FrameColType }[], schema: FrameValue): Promise<FrameHandle> {
    const h = await (this.invoke<string>("engine_assemble", { parts }) as Promise<FrameHandle>);
    return this.remember(h, schema);
  }

  private schemas = new Map<string, FrameValue | null>();
  private pivots = new Map<string, PivotWire>();

  /** After a chain ending in a pivot, the engine's layout for the result. */
  private async rememberPivot(h: FrameHandle, before: FrameValue | null, op: FrameOp | undefined): Promise<void> {
    if (op?.kind !== "pivot") return;
    const layout = await this.invoke<unknown>("engine_pivot_layout", { handle: h });
    this.pivots.set(h, { layout, units: before ? pivotUnits(before, op).units : [] });
  }
  /** Frames holding an error cell the engine can't store compute here, on the oracle. */
  private oracle = new JsFrameBackend();

  /** An op this engine can't run: Polars has no pivot layout and none of the Rust core's cleaning verbs. */
  private needsOracle(op: FrameOp): boolean {
    if (op.kind === "pivot") return !this.fullCells || pivotNeedsOracle(op);
    return !this.fullCells && RUST_CORE_ONLY.has(op.kind);
  }

  private async onOracle(handles: readonly FrameHandle[], run: (hs: FrameHandle[]) => Promise<FrameHandle>): Promise<FrameHandle> {
    const temps: FrameHandle[] = [];
    try {
      const hs: FrameHandle[] = [];
      for (const h of handles) {
        if (isOracleHandle(h)) { hs.push(h); continue; }
        const t = await this.oracle.source(await this.collect(h));
        temps.push(t);
        hs.push(t);
      }
      return await run(hs);
    } finally {
      for (const t of temps) this.oracle.drop(t);
    }
  }

  private remember(handle: FrameHandle, schema: FrameValue | null): FrameHandle {
    this.schemas.set(handle, schema);
    return handle;
  }

  private schemaOf(handle: FrameHandle): FrameValue | null {
    return this.schemas.get(handle) ?? null;
  }

  async source(frame: FrameValue): Promise<FrameHandle> {
    if (!this.fullCells) {
      if (holdsTextOrLogicalError(frame)) return this.oracle.source(frame);
      noteLogicalNaN(frame);
    }
    // A lone surrogate would cross as U+FFFD and merge with its neighbours' halves.
    if (!crossesWhole(frame)) return this.oracle.source(frame);
    if (this.bulk) return this.remember(this.bulk.source(frame), schemaOnly(frame));
    const wire = { columns: frame.columns.map((c) => ({ name: c.name, type: c.type, values: c.values.map(encodeWireCell) })) };
    const h = await (this.invoke<string>("engine_source", { frame: wire }) as Promise<FrameHandle>);
    return this.remember(h, schemaOnly(frame));
  }

  async apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle> {
    if (isOracleHandle(handle)) return this.oracle.apply(handle, op);
    if (this.needsOracle(op)) return this.onOracle([handle], ([h]) => this.oracle.apply(h, op));
    if (op.kind === "formats") return this.applyMany(handle, [op]);
    const { wire, schema } = lowerForEngine(this.schemaOf(handle), [op]);
    const h = await (this.invoke<string>("engine_apply", { handle, op: this.fullCells ? encodeOpCells(wire[0]) : wire[0] }) as Promise<FrameHandle>);
    await this.rememberPivot(h, this.schemaOf(handle), op);
    return this.remember(h, schema);
  }

  async applyMany(handle: FrameHandle, ops: readonly FrameOp[]): Promise<FrameHandle> {
    if (isOracleHandle(handle)) return this.oracle.applyMany(handle, ops);
    if (ops.some((op) => this.needsOracle(op))) return this.onOracle([handle], ([h]) => this.oracle.applyMany(h, ops));
    const { wire, schema } = lowerForEngine(this.schemaOf(handle), ops);
    const h = await (this.invoke<string>("engine_apply_many", { handle, ops: this.fullCells ? wire.map(encodeOpCells) : wire }) as Promise<FrameHandle>);
    let last = ops.length - 1;
    while (last >= 0 && ops[last].kind === "formats") last--;
    if (ops[last]?.kind === "pivot") await this.rememberPivot(h, lowerForEngine(this.schemaOf(handle), ops.slice(0, last)).schema, ops[last]);
    return this.remember(h, schema);
  }

  async join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle> {
    if (isOracleHandle(left) || isOracleHandle(right)) return this.onOracle([left, right], ([l, r]) => this.oracle.join(l, r, opts));
    const l = this.schemaOf(left), r = this.schemaOf(right);
    let wireOpts = opts;
    if (l && r && opts.how !== "cross" && opts.rightKeyScale === undefined && opts.rightKeyOffset === undefined) {
      const t = joinKeyTransform(l.columns.find((c) => c.name === opts.leftKey), r.columns.find((c) => c.name === opts.rightKey));
      if (t) wireOpts = { ...opts, rightKeyScale: t.scale, rightKeyOffset: t.offset };
    }
    const h = await (this.invoke<string>("engine_join", { left, right, opts: wireOpts }) as Promise<FrameHandle>);
    return this.remember(h, l && r ? shadow(() => joinFrames(l, r, wireOpts)) : null);
  }

  async append(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    if (handles.some(isOracleHandle)) return this.onOracle(handles, (hs) => this.oracle.append(hs));
    const h = await (this.invoke<string>("engine_append", { handles }) as Promise<FrameHandle>);
    const ss = handles.map((x) => this.schemaOf(x));
    return this.remember(h, ss.every(Boolean) ? shadow(() => appendFrames(ss as FrameValue[])) : null);
  }

  async bindColumns(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    if (handles.some(isOracleHandle)) return this.onOracle(handles, (hs) => this.oracle.bindColumns(hs));
    const h = await (this.invoke<string>("engine_bind_columns", { handles }) as Promise<FrameHandle>);
    const ss = handles.map((x) => this.schemaOf(x));
    return this.remember(h, ss.every(Boolean) ? shadow(() => bindColumns(ss as FrameValue[])) : null);
  }

  async preview(handle: FrameHandle, n: number): Promise<FramePreview> {
    if (isOracleHandle(handle)) return this.oracle.preview(handle, n);
    if (this.bulk) {
      const r = this.bulk.read(handle, undefined, n)!;
      const take = Math.max(0, Math.min(n, r.rowCount));
      const rows: FrameCell[][] = [];
      for (let i = 0; i < take; i++) rows.push(r.columns.map((c) => (i < c.values.length ? c.values[i] : null)));
      return {
        schema: withSchemaMeta(r.columns.map((c) => ({ name: c.name, type: c.type })), this.schemaOf(handle)),
        rows, rowCount: r.rowCount, truncated: r.rowCount > take,
      };
    }
    const p = await this.invoke<FramePreview>("engine_preview", { handle, n });
    return {
      ...p,
      schema: withSchemaMeta(p.schema, this.schemaOf(handle)),
      rows: p.rows.map((r) => r.map(decodeWireCell)) as FramePreview["rows"],
    };
  }

  async collect(handle: FrameHandle): Promise<FrameValue> {
    if (isOracleHandle(handle)) return this.oracle.collect(handle);
    if (this.bulk) {
      const frame: FrameValue = { __frame: true, columns: withSchemaMeta(this.bulk.read(handle)!.columns, this.schemaOf(handle)) };
      const pivot = this.pivots.get(handle);
      if (pivot) adoptPivot(frame, pivot);
      return frame;
    }
    const columns = await this.invoke<FrameColumn[]>("engine_collect", { handle });
    return { __frame: true, columns: withSchemaMeta(decodeWireColumns(columns), this.schemaOf(handle)) };
  }

  async column(handle: FrameHandle, name: string): Promise<FrameColumn | null> {
    if (isOracleHandle(handle)) return this.oracle.column(handle, name);
    if (this.bulk) {
      const r = this.bulk.read(handle, name);
      return r ? withSchemaMeta(r.columns, this.schemaOf(handle))[0] : null;
    }
    const c = await this.invoke<FrameColumn | null>("engine_column", { handle, name });
    if (!c) return null;
    const [out] = withSchemaMeta([{ ...c, values: c.values.map(decodeWireCell) as FrameColumn["values"] }], this.schemaOf(handle));
    return out;
  }

  drop(handle: FrameHandle): void {
    if (isOracleHandle(handle)) { this.oracle.drop(handle); return; }
    this.schemas.delete(handle);
    this.pivots.delete(handle);
    void this.invoke("engine_drop", { handle }).catch(() => {});
  }

  async sample(handle: FrameHandle, n: number): Promise<{ handle: FrameHandle; factor: number }> {
    if (isOracleHandle(handle)) return this.oracle.sample(handle, n);
    const r = await (this.invoke<{ handle: string; factor: number }>("engine_sample", { handle, n }) as Promise<{ handle: FrameHandle; factor: number }>);
    if (r.handle !== handle) this.remember(r.handle, this.schemaOf(handle));
    return r;
  }
}

let _backend: FrameBackend | null = null;

export function frameBackend(): FrameBackend {
  if (!_backend) _backend = new JsFrameBackend();
  return _backend;
}

function clearHandleKeyedCaches(): void {
  _sourceCache = new WeakMap();
  clearCollectMemo();
  _sampleFactor.clear();
  _sketchInfo.clear();
  _aggGuardInfo.clear();
}

export function setFrameBackend(backend: FrameBackend): void {
  _backend = backend;
  clearHandleKeyedCaches();
}

export function resetFrameBackendToJs(): void {
  _backend = new JsFrameBackend();
  clearHandleKeyedCaches();
}

/** The native engine runs frame verbs: the desktop app, unless Settings turns it off to compare with the web's oracle. */
export function nativeEngineOn(): boolean {
  return engineAvailable() && settingsStore.get("nativeEngine") !== false;
}


/** Polars where the desktop has it on, else the Rust engine in WebAssembly where it is on, else the JS oracle. */
export async function initFrameBackend(): Promise<void> {
  if (nativeEngineOn()) {
    try {
      const info = await enginePing();
      if (info?.backend === "polars") {
        await ipcInvoke("engine_clear", {}).catch(() => {});
        setFrameBackend(new EngineBackend(ipcInvoke, false));
        // Pivots and formulas run on the Rust core beside Polars, which has neither.
        if (wasmEngineOn()) await loadWasmEngine();
        return;
      }
    } catch {
    }
  }
  if (wasmEngineOn() && await loadWasmEngine()) {
    await wasmInvoke("engine_clear", {});
    setFrameBackend(new EngineBackend(wasmInvoke, true, wasmBulk));
    return;
  }
  if (_backend instanceof EngineBackend) resetFrameBackendToJs();
}

/** Flipping an engine switch swaps the backend and hands back so the caller reloads the document: no frame may
 *  keep a handle from the engine it left. */
export function watchEngineSetting(onSwitched: () => void): void {
  const engines = () => `${settingsStore.get("nativeEngine")}|${settingsStore.get("wasmEngine")}`;
  let last = engines();
  settingsStore.subscribe(() => {
    const now = engines();
    if (now === last) return;
    last = now;
    void initFrameBackend().then(onSwitched);
  });
}

/** The Rust engine in WebAssembly as the backend, for tests and scripts that loaded its bytes themselves. */
export function useWasmBackend(): void {
  setFrameBackend(new EngineBackend(wasmInvoke, true, wasmBulk));
}

export async function readCsvFrame(folder: string, name: string): Promise<FrameValue | SolError> {
  try {
    const columns = await ipcInvoke<FrameColumn[]>("engine_read_csv", { folder, name });
    return { __frame: true, columns };
  } catch (e) {
    return asErrorValue(e);
  }
}

function asErrorValue(e: unknown): SolError {
  return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
}

let _sourceCache = new WeakMap<FrameValue, Promise<FrameHandle>>();
const _dropReg: FinalizationRegistry<{ be: FrameBackend; h: FrameHandle }> | null =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry(({ be, h }) => be.drop(h))
    : null;

async function inputHandle(input: FrameInput): Promise<{ h: FrameHandle; temp: boolean }> {
  if (isFrameRef(input)) return { h: await flushRef(input), temp: false };
  let p = _sourceCache.get(input);
  if (!p) {
    const be = frameBackend();
    p = be.source(input);
    _sourceCache.set(input, p);
    p.then((h) => _dropReg?.register(input, { be, h })).catch(() => _sourceCache.delete(input));
  }
  return { h: await p, temp: false };
}

export const SKETCH_SAMPLE_ROWS = 10_000;
const _sampleFactor = new Map<FrameHandle, number>();
interface SketchInfo { factor: number; scaleColumns: ReadonlySet<string> }
const _sketchInfo = new Map<FrameHandle, SketchInfo>();
const SKETCH_EXTRAPOLATABLE: ReadonlySet<AggOp> = new Set(["sum", "count"]);

interface AggGuardInfo { baseHandle: FrameHandle; aggCols: ReadonlyMap<string, string> }
const _aggGuardInfo = new Map<FrameHandle, AggGuardInfo>();

async function applyAggGuard(handle: FrameHandle, f: FrameValue): Promise<FrameValue> {
  const info = _aggGuardInfo.get(handle);
  if (!info) return f;
  const needsGuard = (c: FrameColumn) =>
    info.aggCols.has(c.name) && c.values.some((v) => typeof v === "number" && !Number.isFinite(v));
  const needy = f.columns.filter(needsGuard);
  if (needy.length === 0) return f;
  const srcHadInf = new Map<string, boolean>();
  for (const c of needy) {
    const srcName = info.aggCols.get(c.name)!;
    if (!srcHadInf.has(srcName)) {
      const src = await frameBackend().column(info.baseHandle, srcName).catch(() => null);
      srcHadInf.set(srcName, !!src && src.values.some((v) => v === Infinity || v === -Infinity));
    }
  }
  const columns = f.columns.map((c) => {
    if (!needy.includes(c)) return c;
    const inputs = srcHadInf.get(info.aggCols.get(c.name)!) ? [Infinity] : [];
    return {
      ...c,
      values: c.values.map((v) =>
        typeof v === "number" && !Number.isFinite(v) ? guardFinite(v, inputs) : v),
    };
  });
  return { ...f, columns };
}

async function maybeSketchSample(be: FrameBackend, h: FrameHandle): Promise<{ h: FrameHandle; sampledTemp: FrameHandle | null }> {
  if (!calcModeStore.sketchActive() || _sampleFactor.has(h)) return { h, sampledTemp: null };
  const { handle: sampled, factor } = await be.sample(h, SKETCH_SAMPLE_ROWS);
  if (factor <= 1) return { h, sampledTemp: null };
  _sampleFactor.set(sampled, factor);
  return { h: sampled, sampledTemp: sampled };
}

function applySketchScaling(handle: FrameHandle, f: FrameValue): FrameValue {
  const info = _sketchInfo.get(handle);
  if (!info) return f;
  const columns = f.columns.map((c) => (
    info.scaleColumns.has(c.name)
      ? { ...c, values: c.values.map((v) => (typeof v === "number" ? v * info.factor : v)) }
      : c
  ));
  return { ...f, columns, __approx: { factor: info.factor } };
}

export async function runFrameUnary(input: FrameInput, op: FrameOp): Promise<FrameRef | SolError> {
  try {
    if (isFrameRef(input)) return extendRef(input, op);
    const { h } = await inputHandle(input);
    return { __frameRef: h, __plan: [op] };
  } catch (e) {
    return asErrorValue(e);
  }
}

export async function runFrameJoin(left: FrameInput, right: FrameInput, opts: JoinOpts): Promise<FrameRef | SolError> {
  const be = frameBackend();
  const temps: FrameHandle[] = [];
  try {
    const l = await inputHandle(left); if (l.temp) temps.push(l.h);
    const r = await inputHandle(right); if (r.temp) temps.push(r.h);
    return wrapRef(await be.join(l.h, r.h, opts));
  } catch (e) {
    return asErrorValue(e);
  } finally {
    for (const h of temps) be.drop(h);
  }
}

export async function runFrameBindColumns(frames: readonly FrameInput[]): Promise<FrameRef | SolError> {
  const be = frameBackend();
  const temps: FrameHandle[] = [];
  try {
    const handles: FrameHandle[] = [];
    for (const f of frames) { const r = await inputHandle(f); if (r.temp) temps.push(r.h); handles.push(r.h); }
    return wrapRef(await be.bindColumns(handles));
  } catch (e) {
    return asErrorValue(e);
  } finally {
    for (const h of temps) be.drop(h);
  }
}

export async function runFrameAppend(frames: readonly FrameInput[]): Promise<FrameRef | SolError> {
  const be = frameBackend();
  const temps: FrameHandle[] = [];
  try {
    const handles: FrameHandle[] = [];
    for (const f of frames) { const r = await inputHandle(f); if (r.temp) temps.push(r.h); handles.push(r.h); }
    return wrapRef(await be.append(handles));
  } catch (e) {
    return asErrorValue(e);
  } finally {
    for (const h of temps) be.drop(h);
  }
}

export function dropFrameRef(v: unknown): void {
  if (isFrameRef(v) && v.__plan.length === 0) {
    frameBackend().drop(v.__frameRef);
    _sampleFactor.delete(v.__frameRef);
    _sketchInfo.delete(v.__frameRef);
    _aggGuardInfo.delete(v.__frameRef);
  }
}

export async function materialize<T>(p: Promise<T>): Promise<T | SolError> {
  try {
    return await p;
  } catch (e) {
    return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
  }
}
