// [[C16]] polarsEngine, [[C24]] arraySemantics
import {
  getColumn, frameRowCount,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "./frame";
import { applyVerb, joinFrames, joinKeyTransform, appendFrames, bindColumns, sampleFrame, type FrameOp, type JoinOpts, type AggOp } from "./frameVerbs";
import { solError, isSolError, type SolError } from "./errorValue";
import { guardFinite } from "./valueKinds";
import { engineAvailable, enginePing, ipcInvoke } from "./ipcBridge";
import { calcModeStore } from "./calcModeStore";

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
  if (isSolError(v)) return { __err: v.code };
  return v;
}

function decodeWireCell(v: WireCell): unknown {
  if (v && typeof v === "object") {
    const o = v as { __nf?: string; __err?: string };
    if (o.__nf === "inf") return Infinity;
    if (o.__nf === "-inf") return -Infinity;
    if (o.__nf === "nan") return NaN;
    // The code came from this module's encoder, so the cast keeps solError's union closed.
    if (typeof o.__err === "string") return solError(o.__err as Parameters<typeof solError>[0], "from the native engine");
  }
  return v;
}

function decodeWireColumns(columns: FrameColumn[]): FrameColumn[] {
  return columns.map((c) => ({ ...c, values: c.values.map(decodeWireCell) as FrameColumn["values"] }));
}

function schemaOnly(frame: FrameValue): FrameValue {
  return { __frame: true, columns: frame.columns.map(({ raw: _raw, ...c }) => ({ ...c, values: [] })) };
}

function shadow(run: () => FrameValue): FrameValue | null {
  try { return schemaOnly(run()); } catch { return null; }
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

class PolarsBackend implements FrameBackend {
  private schemas = new Map<string, FrameValue | null>();

  private remember(handle: FrameHandle, schema: FrameValue | null): FrameHandle {
    this.schemas.set(handle, schema);
    return handle;
  }

  private schemaOf(handle: FrameHandle): FrameValue | null {
    return this.schemas.get(handle) ?? null;
  }

  async source(frame: FrameValue): Promise<FrameHandle> {
    const wire = { columns: frame.columns.map((c) => ({ name: c.name, type: c.type, values: c.values.map(encodeWireCell) })) };
    const h = await (ipcInvoke<string>("engine_source", { frame: wire }) as Promise<FrameHandle>);
    return this.remember(h, schemaOnly(frame));
  }

  async apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle> {
    const h = await (ipcInvoke<string>("engine_apply", { handle, op }) as Promise<FrameHandle>);
    const s = this.schemaOf(handle);
    return this.remember(h, s ? shadow(() => applyVerb(s, op)) : null);
  }

  async applyMany(handle: FrameHandle, ops: readonly FrameOp[]): Promise<FrameHandle> {
    const h = await (ipcInvoke<string>("engine_apply_many", { handle, ops }) as Promise<FrameHandle>);
    const s = this.schemaOf(handle);
    return this.remember(h, s ? shadow(() => ops.reduce((f, op) => applyVerb(f, op), s)) : null);
  }

  async join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle> {
    const l = this.schemaOf(left), r = this.schemaOf(right);
    let wireOpts = opts;
    if (l && r && opts.how !== "cross" && opts.rightKeyScale === undefined && opts.rightKeyOffset === undefined) {
      const t = joinKeyTransform(l.columns.find((c) => c.name === opts.leftKey), r.columns.find((c) => c.name === opts.rightKey));
      if (t) wireOpts = { ...opts, rightKeyScale: t.scale, rightKeyOffset: t.offset };
    }
    const h = await (ipcInvoke<string>("engine_join", { left, right, opts: wireOpts }) as Promise<FrameHandle>);
    return this.remember(h, l && r ? shadow(() => joinFrames(l, r, wireOpts)) : null);
  }

  async append(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    const h = await (ipcInvoke<string>("engine_append", { handles }) as Promise<FrameHandle>);
    const ss = handles.map((x) => this.schemaOf(x));
    return this.remember(h, ss.every(Boolean) ? shadow(() => appendFrames(ss as FrameValue[])) : null);
  }

  async bindColumns(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    const h = await (ipcInvoke<string>("engine_bind_columns", { handles }) as Promise<FrameHandle>);
    const ss = handles.map((x) => this.schemaOf(x));
    return this.remember(h, ss.every(Boolean) ? shadow(() => bindColumns(ss as FrameValue[])) : null);
  }

  async preview(handle: FrameHandle, n: number): Promise<FramePreview> {
    const p = await ipcInvoke<FramePreview>("engine_preview", { handle, n });
    return {
      ...p,
      schema: withSchemaMeta(p.schema, this.schemaOf(handle)),
      rows: p.rows.map((r) => r.map(decodeWireCell)) as FramePreview["rows"],
    };
  }

  async collect(handle: FrameHandle): Promise<FrameValue> {
    const columns = await ipcInvoke<FrameColumn[]>("engine_collect", { handle });
    return { __frame: true, columns: withSchemaMeta(decodeWireColumns(columns), this.schemaOf(handle)) };
  }

  async column(handle: FrameHandle, name: string): Promise<FrameColumn | null> {
    const c = await ipcInvoke<FrameColumn | null>("engine_column", { handle, name });
    if (!c) return null;
    const [out] = withSchemaMeta([{ ...c, values: c.values.map(decodeWireCell) as FrameColumn["values"] }], this.schemaOf(handle));
    return out;
  }

  drop(handle: FrameHandle): void {
    this.schemas.delete(handle);
    void ipcInvoke("engine_drop", { handle }).catch(() => {});
  }

  async sample(handle: FrameHandle, n: number): Promise<{ handle: FrameHandle; factor: number }> {
    const r = await (ipcInvoke<{ handle: string; factor: number }>("engine_sample", { handle, n }) as Promise<{ handle: FrameHandle; factor: number }>);
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

export async function initFrameBackend(): Promise<void> {
  if (!engineAvailable()) return;
  try {
    const info = await enginePing();
    if (info?.backend === "polars") {
      await ipcInvoke("engine_clear", {}).catch(() => {});
      setFrameBackend(new PolarsBackend());
    }
  } catch {
  }
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
        typeof v === "number" && !Number.isFinite(v) ? guardFinite(v, ...inputs) : v),
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
