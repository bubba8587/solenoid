// [[C130]] rustCore, [[D99]] rustIsSpec, [[C24]] arraySemantics
import type { FormatAnnotation } from "./formatAnnotationStore";
import {
  frameRowCount,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "./frame";
import type { AggOp, FrameOp, JoinOpts, PivotSpec } from "./frameOps";
import { setPivotLayout, type PivotLayout } from "./pivotLayout";
import type { LambdaValue } from "./lambdaValue";
import { coreValue, errorRef, errorFromCore, toWellFormed, engineClock, readReply } from "./coreValues";
export { engineClock, evaluateOnCore, type EngineClock } from "./coreValues";
import { solError, isSolError, type SolError, type SolErrorCode } from "./errorValue";
import { guardFinite } from "./valueKinds";
import { ipcInvoke } from "./ipcBridge";
import { loadWasmEngine, wasmEngineLoaded, wasmInvoke, wasmInvokeSync, wasmSourceBin, wasmReadBin, wasmCsvFrame, onCore, onWasmEngineReset } from "./engineWasm";
import { calcModeStore } from "./calcModeStore";
import { encodeBinary, decodeBinary } from "./binaryCells";

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

// Cells as the core reads them off JSON (`crates/solenoid-core/src/wire.rs`).
type WireCell = unknown;


function encodeWireCell(v: unknown): WireCell {
  if (typeof v === "number" && !Number.isFinite(v)) {
    return { __nf: Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf" };
  }
  if (isSolError(v)) { const ref = errorRef(v); return { __err: v.code, msg: v.message, ...(ref === undefined ? {} : { ref }) }; }
  return v;
}

function decodeWireCell(v: WireCell): unknown {
  if (v && typeof v === "object") {
    const o = v as { __nf?: string; __err?: string; msg?: string; ref?: number };
    if (o.__nf === "inf") return Infinity;
    if (o.__nf === "-inf") return -Infinity;
    if (o.__nf === "nan") return NaN;
    // The code came from this module's encoder, so the cast keeps solError's union closed.
    if (typeof o.__err === "string") {
      return errorFromCore(o.__err, o.msg || "from the engine", o.ref);
    }
  }
  return v;
}

/** A CSV file's text as a typed frame, read on the core ([[C103]] untrustedContentSeams): its delimiter guessed, blank
 *  lines skipped, the first row the header, each column's trimmed text kept as `raw`. */
export function csvToFrame(text: string): FrameValue {
  const columns = decodeBinary(wasmCsvFrame(text));
  for (const c of columns) c.raw ??= c.values.map((v) => (v === null ? "" : (v as string)));
  return { __frame: true, columns };
}

/** Frames cross in bulk without JSON: the wasm engine shares memory with JS, so cells move as buffers. */
const wasmBulk = {
  source: (frame: FrameValue) => wasmSourceBin(encodeBinary(frame)) as FrameHandle,
  read: (handle: FrameHandle, column?: string, limit?: number): { columns: FrameColumn[]; rowCount: number } | null => {
    const b = wasmReadBin(handle, column, limit);
    return b && { columns: decodeBinary(b), rowCount: b.rowCount };
  },
};
const readBulk = (handle: FrameHandle, column?: string, limit?: number) => wasmBulk.read(handle, column, limit)!;

/** Frames through the wasm core at once: sourced, `run` over their handles, its frame read back and every handle
 *  dropped. Throws what the core refuses. */
export function onCoreFrames(inputs: readonly FrameValue[], run: (handles: string[]) => string): FrameValue {
  const handles = inputs.map((f) => wasmSourceBin(encodeBinary(f)));
  let out: string | undefined;
  try {
    out = run(handles);
    return { __frame: true, columns: decodeBinary(wasmReadBin(out)!) };
  } finally {
    for (const h of handles) wasmInvokeSync("engine_drop", { handle: h });
    if (out) wasmInvokeSync("engine_drop", { handle: out });
  }
}

/** Bind's output schema, for a card's shape; null where the core refuses it. */
export const bindSchema = (frames: FrameValue[]): FrameValue | null => onCore(() => {
  try {
    return onCoreFrames(frames, (handles) => wasmInvokeSync<string>("engine_bind_columns", { handles }));
  } catch {
    return null;
  }
}, null);

/** A pivot layout as the engine wrote it, its cells read back, kept beside the frame it laid out. */
export function attachPivotLayout(frame: FrameValue, wire: unknown): void {
  const w = wire as PivotLayout | null;
  if (!w) return;
  const cells = (items: { tuple: FrameCell[] }[]) => items.map((it) => ({ ...it, tuple: it.tuple.map((x) => decodeWireCell(x) as FrameCell) }));
  const layout: PivotLayout = { ...w, rows: cells(w.rows) as PivotLayout["rows"], cols: cells(w.cols) as PivotLayout["cols"] };
  if (w.details) layout.details = w.details.map((d) => ({ ...d, values: d.values.map((x) => decodeWireCell(x) as FrameCell) }));
  setPivotLayout(frame, layout);
}

/** PIVOTBY on the Rust engine, synchronously; null where the core trapped. */
export function pivotOnEngine(f: FrameValue, spec: PivotSpec): FrameValue | null {
  return onCore(() => {
    if (!wasmEngineLoaded()) return null;
    const src = wasmSourceBin(encodeBinary(f));
    let out: string | undefined;
    try {
      out = wasmInvokeSync<string>("engine_apply", { handle: src, op: { kind: "pivot", ...spec } });
      const layout = wasmInvokeSync<unknown>("engine_pivot_layout", { handle: out });
      const frame: FrameValue = { __frame: true, columns: decodeBinary(wasmReadBin(out)!) };
      attachPivotLayout(frame, layout);
      return frame;
    } finally {
      wasmInvokeSync("engine_drop", { handle: src });
      if (out) wasmInvokeSync("engine_drop", { handle: out });
    }
  }, null);
}

type SideValue = (name: string, kind: "var" | "row") => unknown;

interface ColumnOpts { sideValue?: SideValue; reserved?: readonly string[]; lambdas?: Record<string, LambdaValue>; bare?: LambdaValue; alias?: Record<string, string | undefined> }

/** What `engine_compute_column` takes beside the frame: each name the formula reads that no column holds, bound as
 *  `runColumn` would, and the columns it reads. Null where the formula doesn't parse or a value can't cross. */
function columnInputs(expr: string, columns: readonly string[], opts: ColumnOpts):
  { args: Record<string, unknown>; named: Set<string> } | null {
  const lambdas = opts.lambdas ?? {};
  const bodies = [...Object.values(lambdas), ...(opts.bare ? [opts.bare] : [])].flatMap((l) => (l.expr ? [toWellFormed(l.expr)] : []));
  expr = toWellFormed(expr);
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

type ColumnAnswer = { cells: FrameCell[]; sideVars: string[] } | SolError;

/** What `engine_compute_column` answered: the cells, the error that stopped the column, or null where a body bailed. */
function columnAnswer(r: { bail?: boolean; error?: { code: string; message: string }; handle?: string; sideVars?: string[] }, read: (h: string) => FrameCell[]):
  ColumnAnswer | null {
  if (r.bail) return null;
  if (r.error) return solError(r.error.code as SolErrorCode, r.error.message);
  return { cells: read(r.handle!), sideVars: r.sideVars! };
}



/** A frame computation no formula shares, on the core (`frame_fns.rs`, [[D99]] rustIsSpec): its frames as names, types
 *  and cells (units, formats and provenance are the caller's to carry over), and its answer as a frame, a value, or a
 *  frame with a value beside it; it throws what the TS throws. Null where the wasm engine is off, a value can't cross,
 *  or the core leaves the reading to the TS. */
export function frameFnOnCore(name: string, frames: readonly FrameValue[], args: readonly unknown[] = []):
  { frame: FrameValue; value?: unknown } | { value: unknown } | null {
  return onCore(() => {
    if (!wasmEngineLoaded()) return null;
    const wire = args.map((a) => coreValue(a));
    if (wire.includes(undefined)) return null;
    const handles = frames.map((f) => wasmSourceBin(encodeBinary(f, false)));
    let out: string | undefined;
    try {
      const r = wasmInvokeSync<{ bail?: boolean; handle?: string; value?: unknown; error?: { code: string; message: string; ref?: number } }>(
        "engine_frame_fn", { name, handles, args: wire });
      if (r.bail) return null;
      if (r.error) throw errorFromCore(r.error.code, r.error.message, r.error.ref);
      const v = r.value === undefined ? undefined : readReply(r.value);
      if (v === null) return null;
      if (r.handle) {
        out = r.handle;
        const frame: FrameValue = { __frame: true, columns: decodeBinary(wasmReadBin(out)!) };
        return v ? { frame, value: v.value } : { frame };
      }
      return v ?? null;
    } finally {
      for (const h of handles) wasmInvokeSync("engine_drop", { handle: h });
      if (out) wasmInvokeSync("engine_drop", { handle: out });
    }
  }, null);
}

/** `computeColumnCells` on the core ([[D99]] rustIsSpec): a formula, or with `bare` a wired LAMBDA called with each
 *  row's cells. Null where the wasm engine is off, a value can't cross, or a body leaves the column to the TS. */
export function computeColumnOnEngine(f: FrameValue, expr: string, rows: number, opts: ColumnOpts = {}): ColumnAnswer | null {
  return onCore(() => {
    if (!wasmEngineLoaded()) return null;
    const inputs = columnInputs(expr, f.columns.map((c) => c.name), opts);
    if (!inputs) return null;
    const frame: FrameValue = { __frame: true, columns: f.columns.filter((c) => inputs.named.has(c.name)) };
    const src = wasmSourceBin(encodeBinary(frame, false));
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
  }, null);
}

/** The same over a frame already in the wasm engine: only the answer column comes back, and `col` keeps it in the
 *  engine for `assembleOnEngine`. Null where the active backend isn't the wasm engine or the formula isn't ported. */
export async function computeColumnOnRef(
  ref: FrameRef, expr: string, columns: readonly string[],
  opts: { sideValue?: SideValue; reserved?: readonly string[] } = {},
): Promise<{ cells: FrameCell[]; sideVars: string[]; base: FrameHandle; col: FrameHandle } | SolError | null> {
  const be = frameBackend();
  if (!(be instanceof EngineBackend)) return null;
  const inputs = columnInputs(expr, columns, opts);
  if (!inputs) return null;
  const base = await flushRef(ref);
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
  const metaOf = (as: string) => {
    const c = schema.columns.find((s) => s.name === as);
    return { ...(c?.unit ? { unit: c.unit } : {}), ...(c?.format ? { format: c.format } : {}) };
  };
  return wrapRef(await be.assemble(parts.map((p) => ({ ...p, ...metaOf(p.as) }))));
}

/** A lazy node's output with its own column format picks laid over it ([[D41]] formatFlowsDownstream). */
export function refWithFormats(ref: FrameRef, formats: Record<string, FormatAnnotation>): FrameRef {
  return extendRef(ref, { kind: "formats", formats });
}

/** An op's own cells (a filter's value) in wire form, so an error, NaN or infinity crosses as itself. */
export function encodeOpCells(op: FrameOp): FrameOp {
  if (op.kind === "filter") return { ...op, value: encodeWireCell(op.value) as FrameCell };
  if (op.kind === "filterMulti") return { ...op, conditions: op.conditions.map((c) => ({ ...c, value: encodeWireCell(c.value) as FrameCell })) };
  return op;
}

/** The Rust core in wasm behind handles, on the web and desktop alike ([[C130]] rustCore). A frame's units and formats
 *  live in the core beside its cells; each verb decides its own. */
class EngineBackend implements FrameBackend {
  async computeColumn(handle: FrameHandle, args: Record<string, unknown>): Promise<{ bail?: boolean; error?: { code: string; message: string }; handle?: string; sideVars?: string[] }> {
    return wasmInvoke<{ bail?: boolean; error?: { code: string; message: string }; handle?: string; sideVars?: string[] }>("engine_compute_column", { handle, ...args });
  }

  async assemble(parts: readonly { handle: FrameHandle; column: string; as: string; type: FrameColType }[]): Promise<FrameHandle> {
    return wasmInvoke<string>("engine_assemble", { parts }) as Promise<FrameHandle>;
  }

  /** The layout of each frame a chain ending in a pivot laid out. */
  private pivots = new Map<string, unknown>();

  private async rememberPivot(h: FrameHandle, op: FrameOp | undefined): Promise<void> {
    if (op?.kind === "pivot") this.pivots.set(h, await wasmInvoke<unknown>("engine_pivot_layout", { handle: h }));
  }

  async source(frame: FrameValue): Promise<FrameHandle> {
    return wasmBulk.source(frame);
  }

  async apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle> {
    const h = await (wasmInvoke<string>("engine_apply", { handle, op: encodeOpCells(op) }) as Promise<FrameHandle>);
    await this.rememberPivot(h, op);
    return h;
  }

  async applyMany(handle: FrameHandle, ops: readonly FrameOp[]): Promise<FrameHandle> {
    const h = await (wasmInvoke<string>("engine_apply_many", { handle, ops: ops.map(encodeOpCells) }) as Promise<FrameHandle>);
    const verbs = ops.filter((op) => op.kind !== "formats");
    await this.rememberPivot(h, verbs[verbs.length - 1]);
    return h;
  }

  async join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle> {
    return wasmInvoke<string>("engine_join", { left, right, opts }) as Promise<FrameHandle>;
  }

  async append(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    return wasmInvoke<string>("engine_append", { handles }) as Promise<FrameHandle>;
  }

  async bindColumns(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    return wasmInvoke<string>("engine_bind_columns", { handles }) as Promise<FrameHandle>;
  }

  async preview(handle: FrameHandle, n: number): Promise<FramePreview> {
    const r = readBulk(handle, undefined, n);
    const take = Math.max(0, Math.min(n, r.rowCount));
    const rows: FrameCell[][] = [];
    for (let i = 0; i < take; i++) rows.push(r.columns.map((c) => (i < c.values.length ? c.values[i] : null)));
    return {
      schema: r.columns.map(({ values: _v, raw: _r, ...c }) => c),
      rows, rowCount: r.rowCount, truncated: r.rowCount > take,
    };
  }

  async collect(handle: FrameHandle): Promise<FrameValue> {
    const frame: FrameValue = { __frame: true, columns: readBulk(handle).columns };
    const layout = this.pivots.get(handle);
    if (layout) attachPivotLayout(frame, layout);
    return frame;
  }

  async column(handle: FrameHandle, name: string): Promise<FrameColumn | null> {
    return wasmBulk.read(handle, name)?.columns[0] ?? null;
  }

  drop(handle: FrameHandle): void {
    this.pivots.delete(handle);
    void wasmInvoke("engine_drop", { handle }).catch(() => {});
  }

  async sample(handle: FrameHandle, n: number): Promise<{ handle: FrameHandle; factor: number }> {
    return wasmInvoke<{ handle: string; factor: number }>("engine_sample", { handle, n }) as Promise<{ handle: FrameHandle; factor: number }>;
  }
}

let _backend: FrameBackend | null = null;

export function frameBackend(): FrameBackend {
  if (!_backend) _backend = new EngineBackend();
  return _backend;
}

// A trap's fresh instance holds none of the old one's frames.
onWasmEngineReset(() => clearHandleKeyedCaches());

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

/** Loads the core and starts it empty: a webview reload would otherwise orphan every stored frame. */
export async function initFrameBackend(): Promise<void> {
  await loadWasmEngine();
  await wasmInvoke("engine_clear", {});
  setFrameBackend(new EngineBackend());
}

/** The Rust engine in WebAssembly as the backend, for tests and scripts that loaded its bytes themselves. */
export function useWasmBackend(): void {
  setFrameBackend(new EngineBackend());
}

/** A Parquet file in `folder`, read by the desktop shell (`src-tauri/src/parquet.rs`); its cells cross in wire form. */
export async function readParquetFrame(folder: string, name: string): Promise<FrameValue | SolError> {
  try {
    const columns = await ipcInvoke<FrameColumn[]>("read_parquet", { folder, name });
    return { __frame: true, columns: columns.map((c) => ({ ...c, values: c.values.map(decodeWireCell) as FrameColumn["values"] })) };
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

/** A frame uploaded to the backend, as a ref with nothing planned yet: what a lazy verb's body plans over. */
export async function uploadFrame(input: FrameValue): Promise<FrameRef | SolError> {
  try {
    return wrapRef((await inputHandle(input)).h);
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
