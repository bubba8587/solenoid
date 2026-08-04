// The engine seam: the JS backend (web demo + dev) and the Polars backend
// (desktop, over IPC). A backend OWNS its data and hands out opaque string
// HANDLES; data only crosses back as a value at a MATERIALIZATION boundary —
// `preview` and `column`.
import {
  getColumn, frameRowCount,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "./frame";
import { applyVerb, joinFrames, appendFrames, sampleFrame, type FrameOp, type JoinOpts, type AggOp } from "./frameVerbs";
import { solError, isSolError, type SolError } from "./errorValue";
import { guardFinite } from "./valueKinds";
import { engineAvailable, enginePing, ipcInvoke } from "./ipcBridge";
import { calcModeStore } from "./calcModeStore";

/** Opaque handle to a frame living in a backend. Consumers pass it around and
 *  materialize via the backend; they never read it. (Branded so a bare string
 *  can't be passed by mistake.) */
export type FrameHandle = string & { readonly __frameHandle: unique symbol };

/** The value a LAZY frame carries on a cable: a backend handle plus a queue of
 *  pending unary ops NOT YET sent to the backend. No backend call happens until
 *  a materialization boundary (`readFrame`/`collectPreview`) or a binary op
 *  (join/append, which need a real handle for both sides) flushes it. */
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

/** What a frame cable can carry: a materialized FrameValue (from a source / eager
 *  node) or a lazy FrameRef (from a verb node). The runners + readFrame accept both. */
export type FrameInput = FrameValue | FrameRef;

// Memoize by the REF OBJECT (not the base handle string): two refs can share a
// base handle while carrying DIFFERENT pending plans (a fan-out point followed
// by different downstream verbs), so keying by handle would wrongly collapse
// them. processGraph clears both at each pass start — refs are never reused
// across passes, so within one pass the cached result is always the right one.
let _flushMemo = new Map<FrameRef, Promise<FrameHandle>>();
let _collectMemo = new Map<FrameRef, Promise<FrameValue | SolError | null>>();

/** Resolve a ref's pending plan to a REAL backend handle, one combined
 *  `applyMany` round trip for the whole queue — the fusion entry point. A ref
 *  with an empty plan already IS its own handle (a join/append result, or one
 *  already flushed this pass), so this is then a cheap no-op. Memoized per
 *  pass so multiple consumers of the SAME ref (fan-out) flush once. */
export async function flushRef(ref: FrameRef): Promise<FrameHandle> {
  if (ref.__plan.length === 0) return ref.__frameRef;
  let p = _flushMemo.get(ref);
  if (!p) {
    p = applyPlanWithSketchSampling(ref.__frameRef, ref.__plan);
    _flushMemo.set(ref, p);
  }
  return p;
}

/** Run a ref's whole pending plan through `applyMany` in ONE round trip. Fusion
 *  means the backend never sees the individual verbs, so sketch sampling has to
 *  happen here, once, on the plan's BASE handle. Sketch scaling is keyed off the
 *  LAST groupBy in the plan (marking propagates through a non-aggregating verb
 *  and resets at the next groupBy), falling back to the sampled input's own
 *  marking when the plan has no groupBy. */
async function applyPlanWithSketchSampling(baseHandle: FrameHandle, plan: readonly FrameOp[]): Promise<FrameHandle> {
  const be = frameBackend();
  const sample = await maybeSketchSample(be, baseHandle);
  const factor = _sampleFactor.get(sample.h) ?? 1;
  try {
    const outHandle = await be.applyMany(sample.h, plan);
    const lastGroupBy = [...plan].reverse().find((op): op is Extract<FrameOp, { kind: "groupBy" }> => op.kind === "groupBy");
    // Aggregate provenance for the non-finite guard, keyed off the UNSAMPLED
    // base so the guard's input scan survives the sampledTemp drop.
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

/** Clear the per-pass memos, dropping every handle the LAST pass flushed (a
 *  flush registers a genuinely NEW backend handle nobody else owns — unlike a
 *  base/source handle, which the source-handle cache or an upstream node
 *  already tracks for its own drop). Safe at the top of the NEXT pass: by then
 *  every consumer of the finished pass's results (cachedResult/preview values)
 *  has already read them — they're plain JS objects, not handle-dependent. */
export function clearCollectMemo(): void {
  const be = frameBackend();
  for (const p of _flushMemo.values()) {
    // Drop the handle AND its sketch bookkeeping — same rule as dropFrameRef
    // ("else a sketch-mode entry outlives its handle forever"); handles are
    // monotonic (never recycled), so a missed delete is a per-pass leak.
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
 *  boundary. A FrameValue / SolError / null passes straight through; a FrameRef's
 *  pending plan is flushed then collected through the backend (instant on web, an
 *  IPC round trip on desktop), memoized per compute pass. */
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
  if (p.truncated) f.__totalRows = p.rowCount; // the chip shows the true count
  return f;
}

/** Collect a verb output for its CARD preview: a small frame in FULL (raw fidelity +
 *  test parity), a LARGE one as a head-N FrameValue carrying the true total row count
 *  — so an intermediate verb on a million-row chain never hauls the whole frame back.
 *  A FrameValue already materialized in JS passes through unchanged. */
export async function collectPreview(out: FrameInput | SolError | null, n = CARD_PREVIEW_ROWS): Promise<FrameValue | SolError | null> {
  if (out == null) return null;
  if (isSolError(out)) return out;
  if (!isFrameRef(out)) return out;
  const handle = await flushRef(out);
  const p = await materialize((async () => frameBackend().preview(handle, n))());
  if (isSolError(p)) return p;
  if (!p.truncated) return readFrame(out); // small enough to show whole — collect full
  const f = previewToFrame(p);
  f.__ref = out; // let the grid popup fetch the FULL frame on demand (audit 22p)
  return applyAggGuard(handle, applySketchScaling(out.__frameRef, f));
}

/** One column's identity in a preview (no values — schema only). */
export interface FrameSchemaColumn {
  name: string;
  type: FrameColType;
}

/** A materialized snapshot for display: the schema, the first N rows, and the
 *  TRUE total row count (so the UI can show "1,000 rows" while holding N). */
export interface FramePreview {
  schema: FrameSchemaColumn[];
  /** Head rows, row-major, aligned to `schema`; `null` for a short column. */
  rows: FrameCell[][];
  rowCount: number;
  /** True when `rowCount > rows.length` — the preview is a head, not the whole. */
  truncated: boolean;
}

/** The two-implementation seam. Async because the Polars backend is IPC; the JS
 *  backend resolves immediately. `drop` is fire-and-forget (best-effort free). */
export interface FrameBackend {
  /** Register an already-materialized frame, returning its handle. The eager →
   *  handle bridge (Build Frame, a list widened to a frame row, a source node). */
  source(frame: FrameValue): Promise<FrameHandle>;
  /** Compose a unary verb onto a handle, returning a NEW handle (the old one
   *  stays valid until dropped). Cheap — no materialization; the JS backend
   *  transforms in memory, the Polars backend extends a lazy plan. */
  apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle>;
  /** Compose MULTIPLE unary verbs onto a handle in ONE round trip, returning a
   *  new handle — the fusion primitive (`flushRef` in this module): the Polars
   *  backend threads them onto a single lazy plan and collects once; the JS
   *  backend just folds `apply` over the list (already in-process, no IPC to
   *  save, kept for interface symmetry + test parity). */
  applyMany(handle: FrameHandle, ops: readonly FrameOp[]): Promise<FrameHandle>;
  /** Join two handles on a key, returning a new handle. */
  join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle>;
  /** Stack handles vertically (union by column name), returning a new handle. */
  append(handles: readonly FrameHandle[]): Promise<FrameHandle>;
  /** Materialize a preview: schema + first `n` rows + total row count. */
  preview(handle: FrameHandle, n: number): Promise<FramePreview>;
  /** Materialize the WHOLE frame back to an eager `FrameValue`. The transitional
   *  handle → eager bridge the node layer uses to keep full frames flowing on
   *  cables until lazy-handle-on-cable lands; then the only materialization points
   *  are `preview` (display) + `column` (the scalar/list bridge). */
  collect(handle: FrameHandle): Promise<FrameValue>;
  /** Materialize one column as an eager typed list — the handle → eager bridge
   *  (Get Column). `null` when the column name isn't in the frame. */
  column(handle: FrameHandle, name: string): Promise<FrameColumn | null>;
  /** Free a handle's backing data. Safe to call on an unknown/already-dropped
   *  handle (no-op). */
  drop(handle: FrameHandle): void;
  /** Sketch mode (#24): a deterministic (never random) sample of up to `n` rows,
   *  returning a NEW handle plus the scale FACTOR (trueRows/sampleRows so a
   *  sum/count aggregated over the sample can be extrapolated back toward the
   *  true total — factor is 1 when the frame was already at or under `n` rows
   *  (no sampling needed, the "sample" is unchanged from the source). */
  sample(handle: FrameHandle, n: number): Promise<{ handle: FrameHandle; factor: number }>;
}

/** Build a head-N preview from an in-memory frame (shared shaping logic; the
 *  Polars backend produces the same shape from a `.collect().head(n)`). */
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
  // A SOURCED frame is held weakly: the producing node's memoized value is its
  // real owner, and the GC-driven drop that frees the handle (frameBackend's
  // FinalizationRegistry) is keyed on that same FrameValue — a strong entry
  // here would pin its own registry key and the finalizer would never fire.
  // DERIVED frames (apply/join/append results) stay strong — their owning verb
  // node drops them explicitly.
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
    // The code came from OUR encoder (or the engine's guard), so it's one of the
    // app's tagged codes; the cast keeps solError's closed union honest without
    // widening it for the wire.
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
    // Fire-and-forget: a free can't fail meaningfully, and a dropped/unknown
    // handle is a Rust-side no-op. Swallow any rejection (e.g. off-desktop).
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

/** Every handle-keyed cache/marker a backend swap invalidates: the OUTGOING
 *  backend's handles belong to it alone, and a fresh backend's OWN handles start
 *  renumbering from scratch (each `JsFrameBackend`/registration counter is
 *  per-instance) — so a bare string like "jsf:2" is NOT globally unique across
 *  backend instances. Without this, a stale `_collectMemo`/`_sampleFactor`/
 *  `_sketchInfo` entry keyed by a re-used string can leak a PREVIOUS backend's
 *  cached result onto an unrelated frame in the new one. */
function clearHandleKeyedCaches(): void {
  _sourceCache = new WeakMap();
  clearCollectMemo();
  _sampleFactor.clear();
  _sketchInfo.clear();
  _aggGuardInfo.clear();
}

/** Override the active backend (Polars wiring on desktop; tests). */
export function setFrameBackend(backend: FrameBackend): void {
  _backend = backend;
  clearHandleKeyedCaches();
}

/** Reset the seam to a fresh in-process JS backend. For tests that swap to the
 *  Polars backend and need to restore the default between cases. */
export function resetFrameBackendToJs(): void {
  _backend = new JsFrameBackend();
  clearHandleKeyedCaches();
}

/** Pick the frame backend once at startup: `PolarsBackend` when the native
 *  engine answers `"polars"`, the in-process JS backend otherwise. Best-effort
 *  and idempotent. */
export async function initFrameBackend(): Promise<void> {
  if (!engineAvailable()) return;
  try {
    const info = await enginePing();
    if (info?.backend === "polars") {
      // The Rust store is process-global but every handle lives in JS state — a
      // webview reload (Ctrl+R / HMR) discards that state and would orphan every
      // stored frame for the process lifetime. Fresh start.
      await ipcInvoke("engine_clear", {}).catch(() => {});
      setFrameBackend(new PolarsBackend());
    }
  } catch {
    /* keep the JS backend if the engine can't be reached */
  }
}

// Desktop-only: `engine_read_csv` (engine.rs) reads the file off disk through
// Polars' CSV reader, already collected to typed columns. The JS path
// (csv.ts + frame.ts `frameFromCells`) stays the only option on web.
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

// Keyed by FrameValue IDENTITY, so a source node that returns a stable object
// across recomputes keeps its handle across passes; a stale handle is freed when
// the old FrameValue is GC'd (FinalizationRegistry → backend.drop).
let _sourceCache = new WeakMap<FrameValue, Promise<FrameHandle>>();
const _dropReg: FinalizationRegistry<{ be: FrameBackend; h: FrameHandle }> | null =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry(({ be, h }) => be.drop(h))
    : null;

/** Resolve a runner input to a backend handle. A FrameRef's pending plan is
 *  FLUSHED (memoized per pass — see `flushRef`), since a join/append needs a
 *  real handle for both sides. A FrameValue is sourced ONCE and cached by
 *  identity: repeat and concurrent consumers share the upload. `temp` is
 *  always false now — a cached source handle is owned by the cache (freed on
 *  GC), and a flushed handle is owned by the flush memo (freed at the next
 *  pass's `clearCollectMemo`) — neither is dropped by the calling runner. */
async function inputHandle(input: FrameInput): Promise<{ h: FrameHandle; temp: boolean }> {
  if (isFrameRef(input)) return { h: await flushRef(input), temp: false };
  let p = _sourceCache.get(input);
  if (!p) {
    const be = frameBackend();
    p = be.source(input);
    _sourceCache.set(input, p);
    // Register the Rust handle for GC-time drop; evict a rejected upload so a later
    // pass can retry rather than caching the failure forever.
    p.then((h) => _dropReg?.register(input, { be, h })).catch(() => _sourceCache.delete(input));
  }
  return { h: await p, temp: false };
}

// Sketch mode. `_sampleFactor` marks sample-derived handles (trueRows/sampleRows)
// so a verb AFTER a sampled source is not re-sampled. `_sketchInfo` marks a
// handle whose sum/count columns need scaling; scaling is applied at read time
// (`applySketchScaling`), never baked into backend-stored data — a re-source
// round trip carries only plain columns, so the `__approx` marking would
// silently vanish.
export const SKETCH_SAMPLE_ROWS = 10_000;
const _sampleFactor = new Map<FrameHandle, number>();
interface SketchInfo { factor: number; scaleColumns: ReadonlySet<string> }
const _sketchInfo = new Map<FrameHandle, SketchInfo>();
const SKETCH_EXTRAPOLATABLE: ReadonlySet<AggOp> = new Set(["sum", "count"]);

// The engine half of the aggregate non-finite guard: a Polars-typed column
// can't hold a per-cell error, so a non-finite aggregate is classified here at
// the materialization boundary, scanning the plan's BASE column. On the JS
// backend the oracle already errored the cells, so this no-ops.
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

/** Sample `h` (if sketch mode is active and it isn't ALREADY a sample-derived
 *  handle from earlier in this same chain) and record the factor for
 *  propagation. Returns the handle to actually operate on + a handle to drop
 *  afterward (the sample is a short-lived intermediate; `null` when nothing was
 *  sampled). */
async function maybeSketchSample(be: FrameBackend, h: FrameHandle): Promise<{ h: FrameHandle; sampledTemp: FrameHandle | null }> {
  if (!calcModeStore.sketchActive() || _sampleFactor.has(h)) return { h, sampledTemp: null };
  const { handle: sampled, factor } = await be.sample(h, SKETCH_SAMPLE_ROWS);
  if (factor <= 1) return { h, sampledTemp: null };
  _sampleFactor.set(sampled, factor);
  return { h: sampled, sampledTemp: sampled };
}

/** Apply a handle's recorded sketch scaling (if any) to a freshly-materialized
 *  FrameValue: scale the marked sum/count columns by the factor and stamp
 *  `__approx` (frame.ts) so the UI never presents a sample number as exact.
 *  A no-op (returns `f` unchanged) for a handle with no sketch marking. */
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

/** Run a unary verb (NOT pivot, which is deliberately eager) — returning a LAZY
 *  ref. Chaining onto an existing ref just EXTENDS its pending plan; no backend
 *  call happens here. */
export async function runFrameUnary(input: FrameInput, op: FrameOp): Promise<FrameRef | SolError> {
  try {
    if (isFrameRef(input)) return extendRef(input, op);
    const { h } = await inputHandle(input);
    return { __frameRef: h, __plan: [op] };
  } catch (e) {
    return asErrorValue(e);
  }
}

/** Join two frames through the active backend, returning a lazy ref. */
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

/** Append (union by name) frames through the active backend, returning a lazy ref. */
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

/** Drop a verb node's previous output ref when it recomputes (or is removed).
 *  Only a ref with an EMPTY plan owns its `__frameRef` outright (a join/append
 *  result) — a unary-chain ref's `__frameRef` is a BORROWED base (the upstream
 *  node's own ref, or a source-cache handle), never independently owned, so
 *  dropping it here would sever a handle other consumers still need. A no-op
 *  for non-refs and for a pending (non-empty-plan) ref. */
export function dropFrameRef(v: unknown): void {
  if (isFrameRef(v) && v.__plan.length === 0) {
    frameBackend().drop(v.__frameRef);
    // else a sketch-mode entry outlives its handle forever
    _sampleFactor.delete(v.__frameRef);
    _sketchInfo.delete(v.__frameRef);
    _aggGuardInfo.delete(v.__frameRef);
  }
}

/** Await a materialization (`preview` / `column`) and return a tagged `SolError`
 *  as a VALUE instead of throwing. A consuming node MUST use this: a raw throw
 *  out of `data()` is caught by `installErrorGuards` and flattened to a generic
 *  `#ERROR!` (subsystem-invariants §4.3), losing the specific code (e.g. `#REF!`
 *  for a dropped/unknown handle). This is the bridge from the async handle world
 *  back to the eager, error-as-value model the rest of the graph speaks. */
export async function materialize<T>(p: Promise<T>): Promise<T | SolError> {
  try {
    return await p;
  } catch (e) {
    return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
  }
}
