import {
  getColumn, frameRowCount,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "./frame";
import { applyVerb, joinFrames, appendFrames, bindColumns, sampleFrame, type FrameOp, type JoinOpts, type AggOp } from "./frameVerbs";
import { solError, isSolError, type SolError } from "./errorValue";
import { guardFinite } from "./valueKinds";
import { engineAvailable, enginePing, ipcInvoke } from "./ipcBridge";
import { calcModeStore } from "./calcModeStore";

/** Opaque branded handle to a frame living in a backend; consumers never read it. */
export type FrameHandle = string & { readonly __frameHandle: unique symbol };

/** A backend handle plus a queue of pending unary ops; nothing reaches the backend
 *  until a materialization boundary or a binary op (join/append) flushes it. */
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

// Memoized by the REF OBJECT, never the base handle: two refs can share a handle
// while carrying DIFFERENT pending plans, so keying by handle would collapse them.
let _flushMemo = new Map<FrameRef, Promise<FrameHandle>>();
let _collectMemo = new Map<FrameRef, Promise<FrameValue | SolError | null>>();

/** Resolve a ref's pending plan to a real handle in ONE `applyMany` round trip —
 *  the fusion entry point, memoized per pass so a fan-out ref flushes once. */
export async function flushRef(ref: FrameRef): Promise<FrameHandle> {
  if (ref.__plan.length === 0) return ref.__frameRef;
  let p = _flushMemo.get(ref);
  if (!p) {
    p = applyPlanWithSketchSampling(ref.__frameRef, ref.__plan);
    _flushMemo.set(ref, p);
  }
  return p;
}

/** Fusion hides the individual verbs from the backend, so sketch sampling happens
 *  here once on the plan's BASE handle, scaled off the LAST groupBy in the plan. */
async function applyPlanWithSketchSampling(baseHandle: FrameHandle, plan: readonly FrameOp[]): Promise<FrameHandle> {
  const be = frameBackend();
  const sample = await maybeSketchSample(be, baseHandle);
  const factor = _sampleFactor.get(sample.h) ?? 1;
  try {
    const outHandle = await be.applyMany(sample.h, plan);
    const lastGroupBy = [...plan].reverse().find((op): op is Extract<FrameOp, { kind: "groupBy" }> => op.kind === "groupBy");
    // Keyed off the UNSAMPLED base so the guard's input scan survives the sampledTemp drop.
    if (lastGroupBy) {
      _aggGuardInfo.set(outHandle, {
        baseHandle,
        aggCols: new Map(lastGroupBy.aggs.map((a) => [a.as, a.column])),
      });
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

/** Clear the per-pass memos, dropping every handle the LAST pass flushed — only a
 *  flush registers a handle nobody else owns. Safe at the top of the NEXT pass. */
export function clearCollectMemo(): void {
  const be = frameBackend();
  for (const p of _flushMemo.values()) {
    // Drop the sketch bookkeeping with the handle, else it outlives the handle forever.
    p.then((h) => {
      be.drop(h);
      _sampleFactor.delete(h);
      _sketchInfo.delete(h);
      _aggGuardInfo.delete(h);
    }).catch(() => {});
  }
  _flushMemo = new Map();
  _collectMemo = new Map();
}

/** Collect a cable's frame value back to an eager FrameValue — the materialization
 *  boundary; memoized per compute pass. */
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
  }));
  const f: FrameValue = { __frame: true, columns };
  if (p.truncated) f.__totalRows = p.rowCount;
  return f;
}

/** Collect a verb output for its CARD preview: a small frame in FULL, a large one as
 *  a head-N FrameValue carrying the true total row count. */
export async function collectPreview(out: FrameInput | SolError | null, n = CARD_PREVIEW_ROWS): Promise<FrameValue | SolError | null> {
  if (out == null) return null;
  if (isSolError(out)) return out;
  if (!isFrameRef(out)) return out;
  const handle = await flushRef(out);
  const p = await materialize((async () => frameBackend().preview(handle, n))());
  if (isSolError(p)) return p;
  if (!p.truncated) return readFrame(out);
  const f = previewToFrame(p);
  f.__ref = out; // the grid popup fetches the FULL frame on demand
  return applyAggGuard(handle, applySketchScaling(out.__frameRef, f));
}

export interface FrameSchemaColumn {
  name: string;
  type: FrameColType;
}

/** A display snapshot: schema, first N rows, and the TRUE total row count. */
export interface FramePreview {
  schema: FrameSchemaColumn[];
  /** Head rows, row-major, aligned to `schema`; `null` for a short column. */
  rows: FrameCell[][];
  rowCount: number;
  truncated: boolean;
}

/** The two-implementation seam — async because the Polars backend is IPC. */
export interface FrameBackend {
  /** The eager → handle bridge (Build Frame, a list widened to a row, a source node). */
  source(frame: FrameValue): Promise<FrameHandle>;
  /** Returns a NEW handle; the old one stays valid until dropped. No materialization. */
  apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle>;
  /** The fusion primitive: one round trip for the whole queue (`flushRef`). */
  applyMany(handle: FrameHandle, ops: readonly FrameOp[]): Promise<FrameHandle>;
  join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle>;
  /** Stacks vertically, union by column NAME. */
  append(handles: readonly FrameHandle[]): Promise<FrameHandle>;
  /** Binds side by side by POSITION; ragged pads with blanks. */
  bindColumns(handles: readonly FrameHandle[]): Promise<FrameHandle>;
  preview(handle: FrameHandle, n: number): Promise<FramePreview>;
  collect(handle: FrameHandle): Promise<FrameValue>;
  /** `null` when the column name isn't in the frame. */
  column(handle: FrameHandle, name: string): Promise<FrameColumn | null>;
  /** Safe on an unknown/already-dropped handle (no-op). */
  drop(handle: FrameHandle): void;
  /** A DETERMINISTIC (never random) sample of up to `n` rows plus the scale factor
   *  trueRows/sampleRows — factor 1 means nothing was sampled. */
  sample(handle: FrameHandle, n: number): Promise<{ handle: FrameHandle; factor: number }>;
}

/** The Polars backend must produce this same shape from a `.collect().head(n)`. */
export function framePreview(frame: FrameValue, n: number): FramePreview {
  const rowCount = frameRowCount(frame);
  const take = Math.max(0, Math.min(n, rowCount));
  const rows: FrameCell[][] = [];
  for (let r = 0; r < take; r++) {
    rows.push(frame.columns.map((c) => (r < c.values.length ? c.values[r] : null)));
  }
  return {
    schema: frame.columns.map((c) => ({ name: c.name, type: c.type })),
    rows,
    rowCount,
    truncated: rowCount > take,
  };
}

class JsFrameBackend implements FrameBackend {
  // A SOURCED frame is held WEAKLY — a strong entry would pin its own
  // FinalizationRegistry key and the GC-driven drop would never fire; DERIVED
  // frames stay strong (their owning verb node drops them explicitly).
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

// The arg names below must match the Rust command parameters exactly
// (`src-tauri/src/engine.rs`).
type WireCell = unknown;

function encodeWireCell(v: unknown): WireCell {
  if (typeof v === "number" && !Number.isFinite(v)) {
    return { __nf: Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf" };
  }
  if (isSolError(v)) return { __err: v.code };
  return v;
}

function decodeWireCell(v: WireCell): unknown {
  if (v && typeof v === "object") {
    const o = v as { __nf?: string; __err?: string };
    if (o.__nf === "inf") return Infinity;
    if (o.__nf === "-inf") return -Infinity;
    if (o.__nf === "nan") return NaN;
    // The code came from OUR encoder, so the cast keeps solError's union closed.
    if (typeof o.__err === "string") return solError(o.__err as Parameters<typeof solError>[0], "from the native engine");
  }
  return v;
}

function decodeWireColumns(columns: FrameColumn[]): FrameColumn[] {
  return columns.map((c) => ({ ...c, values: c.values.map(decodeWireCell) as FrameColumn["values"] }));
}

class PolarsBackend implements FrameBackend {
  async source(frame: FrameValue): Promise<FrameHandle> {
    const wire = { columns: frame.columns.map((c) => ({ name: c.name, type: c.type, values: c.values.map(encodeWireCell) })) };
    return ipcInvoke<string>("engine_source", { frame: wire }) as Promise<FrameHandle>;
  }

  async apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle> {
    return ipcInvoke<string>("engine_apply", { handle, op }) as Promise<FrameHandle>;
  }

  async applyMany(handle: FrameHandle, ops: readonly FrameOp[]): Promise<FrameHandle> {
    return ipcInvoke<string>("engine_apply_many", { handle, ops }) as Promise<FrameHandle>;
  }

  async join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle> {
    return ipcInvoke<string>("engine_join", { left, right, opts }) as Promise<FrameHandle>;
  }

  async append(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    return ipcInvoke<string>("engine_append", { handles }) as Promise<FrameHandle>;
  }

  async bindColumns(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    return ipcInvoke<string>("engine_bind_columns", { handles }) as Promise<FrameHandle>;
  }

  async preview(handle: FrameHandle, n: number): Promise<FramePreview> {
    const p = await ipcInvoke<FramePreview>("engine_preview", { handle, n });
    return { ...p, rows: p.rows.map((r) => r.map(decodeWireCell)) as FramePreview["rows"] };
  }

  async collect(handle: FrameHandle): Promise<FrameValue> {
    const columns = await ipcInvoke<FrameColumn[]>("engine_collect", { handle });
    return { __frame: true, columns: decodeWireColumns(columns) };
  }

  async column(handle: FrameHandle, name: string): Promise<FrameColumn | null> {
    const c = await ipcInvoke<FrameColumn | null>("engine_column", { handle, name });
    return c ? { ...c, values: c.values.map(decodeWireCell) as FrameColumn["values"] } : null;
  }

  drop(handle: FrameHandle): void {
    // Fire-and-forget: a free can't fail meaningfully and an unknown handle no-ops.
    void ipcInvoke("engine_drop", { handle }).catch(() => {});
  }

  async sample(handle: FrameHandle, n: number): Promise<{ handle: FrameHandle; factor: number }> {
    return ipcInvoke<{ handle: string; factor: number }>("engine_sample", { handle, n }) as Promise<{ handle: FrameHandle; factor: number }>;
  }
}

let _backend: FrameBackend | null = null;

export function frameBackend(): FrameBackend {
  if (!_backend) _backend = new JsFrameBackend();
  return _backend;
}

/** Handle strings are unique only WITHIN a backend instance, so every handle-keyed
 *  cache must be cleared on a swap or a stale entry leaks onto an unrelated frame. */
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

/** Picks the backend once at startup; best-effort and idempotent. */
export async function initFrameBackend(): Promise<void> {
  if (!engineAvailable()) return;
  try {
    const info = await enginePing();
    if (info?.backend === "polars") {
      // The Rust store is process-global but handles live in JS state, so a webview
      // reload would orphan every stored frame for the process lifetime.
      await ipcInvoke("engine_clear", {}).catch(() => {});
      setFrameBackend(new PolarsBackend());
    }
  } catch {
    /* keep the JS backend if the engine can't be reached */
  }
}

// Desktop-only; the JS path (csv.ts + `frameFromCells`) stays the only option on web.
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

// Keyed by FrameValue IDENTITY, so a stable source object keeps its handle across
// passes; the handle is freed when that FrameValue is GC'd.
let _sourceCache = new WeakMap<FrameValue, Promise<FrameHandle>>();
const _dropReg: FinalizationRegistry<{ be: FrameBackend; h: FrameHandle }> | null =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry(({ be, h }) => be.drop(h))
    : null;

/** Resolve a runner input to a backend handle. `temp` is always false: a cached
 *  source handle is owned by the cache and a flushed one by the flush memo, so the
 *  calling runner must drop neither. */
async function inputHandle(input: FrameInput): Promise<{ h: FrameHandle; temp: boolean }> {
  if (isFrameRef(input)) return { h: await flushRef(input), temp: false };
  let p = _sourceCache.get(input);
  if (!p) {
    const be = frameBackend();
    p = be.source(input);
    _sourceCache.set(input, p);
    // Evict a rejected upload so a later pass retries instead of caching the failure.
    p.then((h) => _dropReg?.register(input, { be, h })).catch(() => _sourceCache.delete(input));
  }
  return { h: await p, temp: false };
}

// Sketch scaling is applied at READ time, never baked into backend-stored data — a
// re-source round trip carries only plain columns and would lose the `__approx` mark.
export const SKETCH_SAMPLE_ROWS = 10_000;
const _sampleFactor = new Map<FrameHandle, number>();
interface SketchInfo { factor: number; scaleColumns: ReadonlySet<string> }
const _sketchInfo = new Map<FrameHandle, SketchInfo>();
const SKETCH_EXTRAPOLATABLE: ReadonlySet<AggOp> = new Set(["sum", "count"]);

// A Polars-typed column can't hold a per-cell error, so a non-finite aggregate is
// classified here at the materialization boundary (a no-op on the JS backend).
interface AggGuardInfo { baseHandle: FrameHandle; aggCols: ReadonlyMap<string, string> } // out name → source column
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
        typeof v === "number" && !Number.isFinite(v) ? guardFinite(v, ...inputs) : v),
    };
  });
  return { ...f, columns };
}

/** Returns the handle to operate on plus a short-lived sample handle to drop
 *  afterward (`null` when nothing was sampled). */
async function maybeSketchSample(be: FrameBackend, h: FrameHandle): Promise<{ h: FrameHandle; sampledTemp: FrameHandle | null }> {
  if (!calcModeStore.sketchActive() || _sampleFactor.has(h)) return { h, sampledTemp: null };
  const { handle: sampled, factor } = await be.sample(h, SKETCH_SAMPLE_ROWS);
  if (factor <= 1) return { h, sampledTemp: null };
  _sampleFactor.set(sampled, factor);
  return { h: sampled, sampledTemp: sampled };
}

/** Stamps `__approx` so the UI never presents a scaled sample number as exact. */
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

/** Run a unary verb (not pivot — deliberately eager), returning a LAZY ref;
 *  chaining onto an existing ref just extends its pending plan. */
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

/** Union by column NAME. */
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

/** Only an EMPTY-plan ref owns its `__frameRef`; a unary-chain ref's handle is
 *  BORROWED from upstream, so dropping it would sever a handle others still need. */
export function dropFrameRef(v: unknown): void {
  if (isFrameRef(v) && v.__plan.length === 0) {
    frameBackend().drop(v.__frameRef);
    // else a sketch-mode entry outlives its handle forever
    _sampleFactor.delete(v.__frameRef);
    _sketchInfo.delete(v.__frameRef);
    _aggGuardInfo.delete(v.__frameRef);
  }
}

/** A consuming node MUST wrap materializations in this: a raw throw out of `data()`
 *  is flattened by `installErrorGuards` to a generic `#ERROR!`, losing the code. */
export async function materialize<T>(p: Promise<T>): Promise<T | SolError> {
  try {
    return await p;
  } catch (e) {
    return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
  }
}
