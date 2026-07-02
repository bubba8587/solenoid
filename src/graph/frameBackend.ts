// ─── FrameBackend: the engine seam ────────────────────────────────────────────
// The frame layer runs on one of two backends without the node layer knowing
// which: the in-process JS model (web demo + dev) or the native Polars engine
// (desktop). A backend OWNS its data and hands out opaque string HANDLES; data
// only crosses back as a value at a MATERIALIZATION boundary — `preview` (schema
// + head-N + row count, for display/inspector) and `column` (one column back as
// an eager list, the bridge to the scalar/list world). See docs/v1.0-plan.md WS2.
//
// This module is the seam + the JS backend only. The Polars backend (desktop)
// implements the SAME interface over IPC (`ipcBridge.ts` → `ipc.rs`), where a
// handle is an id into a Rust-side LazyFrame map and `preview`/`column` are the
// only `.collect()` points. Nothing migrates the nodes onto this yet — that's a
// later increment; today nothing consumes it, so the live app is unchanged.
import {
  getColumn, frameRowCount,
  type FrameValue, type FrameColumn, type FrameCell, type FrameColType,
} from "./frame";
import { applyVerb, joinFrames, appendFrames, type FrameOp, type JoinOpts } from "./frameVerbs";
import { solError, isSolError, type SolError } from "./errorValue";
import { engineAvailable, enginePing, ipcInvoke } from "./ipcBridge";

/** Opaque handle to a frame living in a backend. Consumers pass it around and
 *  materialize via the backend; they never read it. (Branded so a bare string
 *  can't be passed by mistake.) */
export type FrameHandle = string & { readonly __frameHandle: unique symbol };

/** The value a LAZY frame carries on a cable: an object wrapping a backend handle,
 *  so it's unambiguous against a real string (a String socket's value) and a
 *  FrameValue (`__frame`). Verb nodes emit these and chain them; `coerceInputs`
 *  materializes one to a FrameValue for every non-verb consumer (`readFrame`). */
export interface FrameRef { readonly __frameRef: FrameHandle }
export function isFrameRef(v: unknown): v is FrameRef {
  return typeof v === "object" && v !== null && "__frameRef" in v;
}
function wrapRef(h: FrameHandle): FrameRef { return { __frameRef: h }; }

/** What a frame cable can carry: a materialized FrameValue (from a source / eager
 *  node) or a lazy FrameRef (from a verb node). The runners + readFrame accept both. */
export type FrameInput = FrameValue | FrameRef;

// ── Per-pass collect memo (audit finding 24) ────────────────────────────────
// A lazy ref fanned out to N consumers was fully collected N TIMES per pass —
// a Filter feeding 3 Get Columns + Display + Chart on 500k rows meant 5
// identical full-frame serializations. Memoize the collect by handle;
// processGraph clears at each pass start (handles are never reused, so within
// one pass the cached result is always the right one).
let _collectMemo = new Map<FrameHandle, Promise<FrameValue | SolError | null>>();

export function clearCollectMemo(): void {
  _collectMemo = new Map();
}

/** Collect a cable's frame value back to an eager FrameValue — the materialization
 *  boundary. A FrameValue / SolError / null passes straight through; a FrameRef is
 *  collected through the backend (instant on web, an IPC `collect` on desktop),
 *  memoized per compute pass. */
export async function readFrame(v: FrameInput | SolError | null | undefined): Promise<FrameValue | SolError | null> {
  if (v == null) return null;
  if (isSolError(v)) return v;
  if (isFrameRef(v)) {
    let p = _collectMemo.get(v.__frameRef);
    if (!p) {
      p = materialize(frameBackend().collect(v.__frameRef));
      _collectMemo.set(v.__frameRef, p);
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
  const p = await materialize(frameBackend().preview(out.__frameRef, n));
  if (isSolError(p)) return p;
  if (!p.truncated) return readFrame(out); // small enough to show whole — collect full
  const f = previewToFrame(p);
  f.__ref = out; // let the grid popup fetch the FULL frame on demand (audit 22p)
  return f;
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

// ─── JS backend: data lives in-process, the handle is an id into a Map ─────────
// Mirrors the Polars handle model (id → backing frame) so the lifecycle code —
// create a handle, materialize on demand, drop it — is identical across backends.
// Here it's all cheap object refs; on desktop the same calls cross IPC.
class JsFrameBackend implements FrameBackend {
  // A SOURCED frame is held weakly: the producing node's memoized value is its
  // real owner, and the GC-driven drop that was supposed to free the handle
  // (frameBackend's FinalizationRegistry) is keyed on that same FrameValue — a
  // strong entry here pinned its own registry key, so the finalizer never fired
  // and every Frame Input edit leaked the previous frame for the whole web
  // session (audit finding 18). DERIVED frames (apply/join/append results) stay
  // strong — their owning verb node drops them explicitly.
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

  private get(handle: FrameHandle): FrameValue {
    const e = this.store.get(handle);
    const f = e instanceof WeakRef ? e.deref() : e;
    if (!f) throw solError("#REF!", `frame handle ${handle} not found (dropped or never created)`);
    return f;
  }
}

// ─── Polars backend: the same interface, over IPC to the Rust engine ───────────
// The desktop path. Every method is one `invoke` (see `src-tauri/src/engine.rs`):
// a handle is an opaque id into the Rust-side frame store; data only crosses back
// at `preview`/`column`. The arg names match the Rust command parameters exactly.
// Wire shape: a frame is sent as its typed columns ({name,type,values}); the Rust
// side coerces (a per-cell SolError → null) and tags each column with its SolType.
class PolarsBackend implements FrameBackend {
  async source(frame: FrameValue): Promise<FrameHandle> {
    const wire = { columns: frame.columns.map((c) => ({ name: c.name, type: c.type, values: c.values })) };
    return ipcInvoke<string>("engine_source", { frame: wire }) as Promise<FrameHandle>;
  }

  async apply(handle: FrameHandle, op: FrameOp): Promise<FrameHandle> {
    return ipcInvoke<string>("engine_apply", { handle, op }) as Promise<FrameHandle>;
  }

  async join(left: FrameHandle, right: FrameHandle, opts: JoinOpts): Promise<FrameHandle> {
    return ipcInvoke<string>("engine_join", { left, right, opts }) as Promise<FrameHandle>;
  }

  async append(handles: readonly FrameHandle[]): Promise<FrameHandle> {
    return ipcInvoke<string>("engine_append", { handles }) as Promise<FrameHandle>;
  }

  async preview(handle: FrameHandle, n: number): Promise<FramePreview> {
    return ipcInvoke<FramePreview>("engine_preview", { handle, n });
  }

  async collect(handle: FrameHandle): Promise<FrameValue> {
    const columns = await ipcInvoke<FrameColumn[]>("engine_collect", { handle });
    return { __frame: true, columns };
  }

  async column(handle: FrameHandle, name: string): Promise<FrameColumn | null> {
    return ipcInvoke<FrameColumn | null>("engine_column", { handle, name });
  }

  drop(handle: FrameHandle): void {
    // Fire-and-forget: a free can't fail meaningfully, and a dropped/unknown
    // handle is a Rust-side no-op. Swallow any rejection (e.g. off-desktop).
    void ipcInvoke("engine_drop", { handle }).catch(() => {});
  }
}

// ─── Backend selection ─────────────────────────────────────────────────────────
// One module singleton. The JS backend is the default everywhere; WS2's desktop
// wiring calls `setFrameBackend(new PolarsBackend())` at startup when the native
// engine is available (`engineAvailable()` in ipcBridge.ts).
let _backend: FrameBackend | null = null;

export function frameBackend(): FrameBackend {
  if (!_backend) _backend = new JsFrameBackend();
  return _backend;
}

/** Override the active backend (Polars wiring on desktop; tests). Clears the
 *  source-handle cache — its handles belong to the OUTGOING backend, so a frame
 *  cached under the old backend must not resolve to a handle the new one lacks. */
export function setFrameBackend(backend: FrameBackend): void {
  _backend = backend;
  _sourceCache = new WeakMap();
}

/** Reset the seam to a fresh in-process JS backend. For tests that swap to the
 *  Polars backend and need to restore the default between cases. */
export function resetFrameBackendToJs(): void {
  _backend = new JsFrameBackend();
  _sourceCache = new WeakMap();
}

/** Pick the frame backend once at startup. On desktop, ping the native engine; if
 *  it answers with the Polars backend live, switch the seam to `PolarsBackend` so
 *  every frame node (once migrated) runs on Polars. Off-desktop, or if the native
 *  side is absent/older (no `"polars"` backend), the in-process JS backend stays —
 *  the web demo is unchanged. Best-effort + idempotent; safe to call before any
 *  node touches a frame (nothing consumes the seam until the node migration). */
export async function initFrameBackend(): Promise<void> {
  if (!engineAvailable()) return;
  try {
    const info = await enginePing();
    if (info?.backend === "polars") {
      // The Rust store is process-global but every handle lives in JS state — a
      // webview reload (Ctrl+R / HMR) discards that state and would orphan every
      // stored frame for the process lifetime (audit finding 35). Fresh start.
      await ipcInvoke("engine_clear", {}).catch(() => {});
      setFrameBackend(new PolarsBackend());
    }
  } catch {
    /* keep the JS backend if the engine can't be reached */
  }
}

// ─── Node-facing verb runners (the seam the frame verb nodes speak) ────────────
// A frame verb node's data() calls one of these instead of the pure `frameVerbs`
// function directly: source the eager input(s) to handle(s), compose the verb, and
// collect the full frame back. On web this is the JS backend — identical to calling
// the verb (it wraps the same `frameVerbs`); on desktop the verb runs in Polars.
// Handles are created and dropped within the call, so nothing leaks. A verb's
// structural failure (#REF! for a bad column, #TYPE! for an append clash) comes back
// as a tagged SolError VALUE — never a throw out of data() (which the error guard
// would flatten to a generic #ERROR!; see `materialize`).

function asErrorValue(e: unknown): SolError {
  return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
}

// ─── Source-handle cache ────────────────────────────────────────────────────────
// The profiler showed `engine_source` dominating (whole frames re-serialized to Rust
// over and over): a fan-out where N verb nodes read the SAME source FrameValue used to
// upload it N times, and every recompute re-uploaded from scratch. Cache the handle by
// FrameValue IDENTITY so a frame is uploaded ONCE and reused by every consumer. A source
// node that returns a stable object across recomputes (memoized) keeps its handle across
// passes too; a fresh object each pass just re-sources once and the stale handle is freed
// when the old FrameValue is GC'd (FinalizationRegistry → backend.drop). The handle is now
// owned by the cache, never dropped per-call — hence `temp: false` for the cached path.
let _sourceCache = new WeakMap<FrameValue, Promise<FrameHandle>>();
const _dropReg: FinalizationRegistry<{ be: FrameBackend; h: FrameHandle }> | null =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry(({ be, h }) => be.drop(h))
    : null;

/** Resolve a runner input to a backend handle. A FrameRef yields its handle (owned by
 *  the upstream node). A FrameValue is sourced ONCE and cached by identity: repeat and
 *  concurrent consumers share the upload. `temp` is always false now — a cached source
 *  handle is owned by the cache (freed on GC), never dropped by the calling runner. */
async function inputHandle(input: FrameInput): Promise<{ h: FrameHandle; temp: boolean }> {
  if (isFrameRef(input)) return { h: input.__frameRef, temp: false };
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

/** Run a unary verb (select/drop/rename/sort/distinct/head/filter/groupBy/
 *  unpivot — NOT pivot, which is deliberately eager) through the active
 *  backend, returning a LAZY ref — the result stays in
 *  the backend so a chain of verbs never round-trips the frame; it's collected only
 *  at a materialization boundary (readFrame). */
export async function runFrameUnary(input: FrameInput, op: FrameOp): Promise<FrameRef | SolError> {
  const be = frameBackend();
  let temp: FrameHandle | null = null;
  try {
    const { h, temp: t } = await inputHandle(input);
    if (t) temp = h;
    return wrapRef(await be.apply(h, op));
  } catch (e) {
    return asErrorValue(e);
  } finally {
    if (temp) be.drop(temp);
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

/** Drop a verb node's previous output ref when it recomputes (or is removed). The
 *  backend's frames are independent, so this is always safe. A no-op for non-refs. */
export function dropFrameRef(v: unknown): void {
  if (isFrameRef(v)) frameBackend().drop(v.__frameRef);
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
