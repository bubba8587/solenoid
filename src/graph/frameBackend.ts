// [[C130]] rustCore, [[D99]] rustIsSpec
// The core's frames from TypeScript (tree/specs/computation/frame-verbs.md § Lazy frames): a lazy frame is a core value
// (`frame_ref.rs`) whose JavaScript form names it; a JavaScript reader reads it through the core. Beside it, the eager
// frame tools the cards' TS calls, a CSV file's text as a frame, and the desktop's Parquet reader.
import type { FrameValue, FrameColumn, FrameCell, FrameColType } from "./frame";
import type { FrameOp, PivotSpec } from "./frameOps";
import { setPivotLayout, type PivotLayout } from "./pivotLayout";
import type { FormatAnnotation } from "./formatAnnotationStore";
import { coreValue, errorRef, errorFromCore, toWellFormed, engineClock, readReply } from "./coreValues";
export { engineClock, evaluateOnCore, type EngineClock } from "./coreValues";
import { solError, isSolError, type SolError, type SolErrorCode } from "./errorValue";
import type { LambdaValue } from "./lambdaValue";
import { ipcInvoke } from "./ipcBridge";
import { loadWasmEngine, wasmEngineLoaded, wasmInvoke, wasmInvokeSync, wasmSourceBin, wasmReadBin, wasmCsvFrame, onCore, guarded } from "./engineWasm";
import { frameRefRead, frameRefPreview, frameRefThen } from "./engineWasm/solenoid_graph.js";
import { encodeBinary, decodeBinary, binaryFromBytes } from "./binaryCells";

/** A lazy frame as JavaScript holds it: the id the core keeps it under, for as long as this object lives. */
export interface FrameRef {
  readonly __frameRef: number;
}
export function isFrameRef(v: unknown): v is FrameRef {
  return typeof v === "object" && v !== null && "__frameRef" in v;
}

export type FrameInput = FrameValue | FrameRef;

/** A lazy frame read whole, its plan run in the core once a ref; a frame value, `null` or an error as it is. */
export async function readFrame(v: unknown): Promise<FrameValue | SolError | null> {
  if (v == null) return null;
  if (!isFrameRef(v)) return v as FrameValue | SolError;
  try {
    return guarded(() => frameRefRead(v)) as FrameValue | SolError;
  } catch (e) {
    return asErrorValue(e);
  }
}

const CARD_PREVIEW_ROWS = 100;

/** A lazy frame's first `n` rows, its row count as `__totalRows` and itself as `__ref`; the whole frame where it has
 *  no more. It throws the error its plan answers. */
export async function collectPreview(out: unknown, n = CARD_PREVIEW_ROWS): Promise<FrameValue | SolError | null> {
  if (out == null) return null;
  if (!isFrameRef(out)) return out as FrameValue | SolError;
  return guarded(() => frameRefPreview(out, n)) as FrameValue;
}

/** A lazy node's output with its own column format picks laid over it ([[C118]] formatTravelsWithValue). */
export function refWithFormats(ref: FrameRef, formats: Record<string, FormatAnnotation>): FrameRef {
  return guarded(() => frameRefThen(ref, JSON.stringify({ kind: "formats", formats }))) as FrameRef;
}

export interface FrameSchemaColumn {
  name: string;
  type: FrameColType;
  unit?: FrameColumn["unit"];
  format?: FrameColumn["format"];
}

function encodeWireCell(v: unknown): unknown {
  if (typeof v === "number" && !Number.isFinite(v)) {
    return { __nf: Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf" };
  }
  if (isSolError(v)) { const ref = errorRef(v); return { __err: v.code, msg: v.message, ...(ref === undefined ? {} : { ref }) }; }
  return v;
}

function decodeWireCell(v: unknown): unknown {
  if (v && typeof v === "object") {
    const o = v as { __nf?: string; __err?: string; msg?: string; ref?: number };
    if (o.__nf === "inf") return Infinity;
    if (o.__nf === "-inf") return -Infinity;
    if (o.__nf === "nan") return NaN;
    if (typeof o.__err === "string") return errorFromCore(o.__err, o.msg || "from the engine", o.ref);
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

/** PIVOTBY on the core, synchronously, for a shape; null where the core trapped. */
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

/** A frame computation no formula shares, on the core (`frame_fns.rs`, [[D99]] rustIsSpec): its frames as names, types
 *  and cells (units, formats and provenance are the caller's to carry over), and its answer as a frame, a value, or a
 *  frame with a value beside it; it throws what the TS throws. Null where the wasm engine is off, a value can't cross,
 *  or the core leaves the reading to the TS. */
export function frameFnOnCore(name: string, frames: readonly FrameValue[], args: readonly unknown[] = [], units = false):
  { frame: FrameValue; value?: unknown } | { value: unknown } | null {
  return onCore(() => {
    if (!wasmEngineLoaded()) return null;
    const wire = args.map((a) => coreValue(a, units));
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

/** An op's own cells (a filter's value) in wire form, so an error, NaN or infinity crosses as itself. */
export function encodeOpCells(op: FrameOp): FrameOp {
  if (op.kind === "filter") return { ...op, value: encodeWireCell(op.value) as FrameCell };
  if (op.kind === "filterMulti") return { ...op, conditions: op.conditions.map((c) => ({ ...c, value: encodeWireCell(c.value) as FrameCell })) };
  return op;
}

/** Loads the core and starts its store of eager frames empty: a webview reload would otherwise orphan them. */
export async function initFrameBackend(): Promise<void> {
  await loadWasmEngine();
  await wasmInvoke("engine_clear", {});
}

/** A Parquet file in `folder`, read by the desktop shell (`src-tauri/src/ipc.rs`); it crosses as one buffer of the
 *  columnar hand-off. */
export async function readParquetFrame(folder: string, name: string): Promise<FrameValue | SolError> {
  try {
    const bytes = await ipcInvoke<ArrayBuffer>("read_parquet", { folder, name });
    return { __frame: true, columns: decodeBinary(binaryFromBytes(bytes)) };
  } catch (e) {
    return asErrorValue(e);
  }
}

function asErrorValue(e: unknown): SolError {
  return isSolError(e) ? e : solError("#ERROR!", e instanceof Error ? e.message : String(e));
}
