// [[C130]] rustCore, [[D102]] graphOnCore
// The one WebAssembly module: the graph engine and the core it links (`crates/solenoid-graph`, `crates/solenoid-core`),
// answering the core's commands in-process. A trap anywhere drops the instance and brings a fresh one
// (tree/specs/computation/graph-core.md § Traps). `npm run build:wasm` regenerates `engineWasm/`.
import init, { initSync, __wbg_reset, setPanicHandler, display_settings, fmt_scalar, fmt_annotated, fmt_date, card_is_hex_color, card_link_href, card_image_src, read_decimal, read_logical, engine_invoke, engine_source_bin, engine_read_bin, engine_csv_frame, engine_csv_rows, engine_infer_bin, take_tags, take_nums, take_strs, take_lens } from "./engineWasm/solenoid_graph.js";
import { toSolError } from "./errorValue";
import type { ColumnUnit } from "./unitValue";
import type { FormatAnnotation } from "./formatAnnotationStore";

/** The compiled module's location: a URL Vite bundles, and a `file:` URL under Node. */
export const wasmUrl = new URL("./engineWasm/solenoid_graph_bg.wasm", import.meta.url);

let _ready: Promise<void> | null = null;
let _loaded = false;

/** Fetches and instantiates the module once. Nothing computes without it, so the app's first render waits. */
export function loadWasmEngine(): Promise<void> {
  _ready ??= init({ module_or_path: wasmUrl }).then(onLoaded);
  return _ready;
}

/** For hosts that hold the module's bytes (tests, Node scripts). */
export function loadWasmEngineSync(bytes: BufferSource): void {
  if (_loaded) return;
  initSync({ module: bytes });
  onLoaded();
  _ready = Promise.resolve();
}

export function wasmEngineLoaded(): boolean {
  return _loaded && !_dead;
}

const _onLoad: (() => void)[] = [];
const _onReset = new Set<() => void>();

/** `fn` runs once the module is loaded (now, when it is), and again in each fresh instance after a trap. */
export function whenWasmEngineLoads(fn: () => void): void {
  _onLoad.push(fn);
  if (_loaded) fn();
}

/** Runs after the module comes back from a trap: whatever named the dead instance's state forgets it. */
export function onWasmEngineReset(f: () => void): void {
  _onReset.add(f);
}

function onLoaded(): void {
  _loaded = true;
  setPanicHandler(onPanic);
  for (const fn of _onLoad) fn();
}

/** Display formatting runs on the core ([[D94]] oneNumberDisplay); a number shown before the module loads (the app's
 *  chrome renders first) reads as `String(n)`. */
export function coreFormatScalar(n: number): string {
  return wasmEngineLoaded() ? fmt_scalar(n) : String(n);
}

// A column's annotation is one object shown many times, so its JSON is made once.
const annotationText = new WeakMap<FormatAnnotation, string>();

export function coreFormatAnnotated(n: number, annotation: FormatAnnotation): string {
  if (!wasmEngineLoaded()) return String(n);
  let text = annotationText.get(annotation);
  if (text === undefined) annotationText.set(annotation, (text = JSON.stringify(annotation)));
  return fmt_annotated(n, text);
}

export function coreFormatDate(serial: number, pattern: string): string {
  return wasmEngineLoaded() ? fmt_date(serial, pattern) : String(serial);
}

/** A card cell's text read as a colour, a link or an image (`card_helpers.rs`); before the module loads, none. */
export function coreIsHexColor(text: string): boolean {
  return wasmEngineLoaded() && card_is_hex_color(text);
}

export function coreLinkHref(text: string): string | null {
  return wasmEngineLoaded() ? card_link_href(text) ?? null : null;
}

export function coreImageSrc(text: string): string | null {
  return wasmEngineLoaded() ? card_image_src(text) ?? null : null;
}

/** Text read as a number or a logical, as every typed input reads it ([[D93]] oneTextReading). */
export function coreReadDecimal(text: string): number {
  return read_decimal(text);
}

/** 1 for TRUE, 0 for FALSE, NaN when it isn't a logical, undefined for blank. */
export function coreReadLogical(text: string): number | undefined {
  return read_logical(text);
}

/** The "Decimal places" and "Scientific from" settings, as the core formats by them. */
export function setCoreDisplaySettings(numberDecimals: number, sciAbove: string): void {
  if (wasmEngineLoaded()) display_settings(numberDecimals, sciAbove);
}

/** What a call into the module throws, and a fetch in flight rejects with, when the module trapped. */
export class CoreTrap extends Error {}

const _pending = new Set<(e: unknown) => void>();
let _dead = false;
let _generation = 0;

/** A panic starts: whatever awaits the module rejects, and once the stack has left it, a fresh instance takes over. */
function onPanic(message: string): void {
  trapped(new CoreTrap(message));
}

function trapped(error: CoreTrap): void {
  if (_dead) return;
  _dead = true;
  for (const reject of _pending) reject(error);
  _pending.clear();
  queueMicrotask(recover);
}

/** A fresh instance of the compiled module, numbering the core's handles past the dead one's. */
function recover(): void {
  const module = __wbg_reset();
  initSync({ module });
  _dead = false;
  engine_invoke("engine_handle_base", JSON.stringify({ base: ++_generation * 2 ** 32 }));
  onLoaded();
  for (const f of _onReset) f();
}

/** `call()`; a trap during it throws `CoreTrap`. With `anyThrow`, any throw is one: a core command answers in its
 *  reply and never throws otherwise. */
export function guarded<T>(call: () => T, anyThrow = false): T {
  if (_dead) throw new CoreTrap("the engine is reloading");
  if (!_loaded) throw new Error("the wasm engine isn't loaded (loadWasmEngine)");
  try {
    return call();
  } catch (e) {
    const overflow = e instanceof RangeError && /call stack/i.test(e.message);
    if (_dead || anyThrow || overflow || e instanceof WebAssembly.RuntimeError) {
      const trap = e instanceof CoreTrap ? e : new CoreTrap(e instanceof Error ? e.message : String(e));
      trapped(trap);
      throw trap;
    }
    throw e;
  }
}

/** The module's promise, rejecting with `CoreTrap` if the module traps before it settles. */
export function tracked<T>(start: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const settle = (e: unknown) => { _pending.delete(settle); reject(e); };
    _pending.add(settle);
    try {
      guarded(start).then((v) => { _pending.delete(settle); resolve(v); }, settle);
    } catch (e) {
      settle(e);
    }
  });
}

/** `run()`, or `fallback` where the module trapped during it. */
export function onCore<T, F>(run: () => T, fallback: F): T | F {
  try {
    return run();
  } catch (e) {
    if (e instanceof CoreTrap) return fallback;
    throw e;
  }
}

const command = <T>(call: () => T): T => guarded(call, true);

export function wasmInvokeSync<T>(name: string, args: Record<string, unknown> = {}): T {
  const reply = JSON.parse(command(() => engine_invoke(name, JSON.stringify(args)))) as { ok?: T; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  return reply.ok as T;
}

export async function wasmInvoke<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return wasmInvokeSync<T>(name, args);
}

/** A frame's cells in the engine's columnar hand-off (crates/solenoid-core/src/binary.rs). */
export interface BinaryCells {
  /** A `raw` entry is the source text of the column before it. */
  schema: { name: string; type: string; len: number; raw?: boolean; unit?: ColumnUnit; format?: FormatAnnotation }[];
  tags: Uint8Array;
  nums: Float64Array;
  strs: string;
  lens: Uint32Array;
}

export function wasmSourceBin(cells: BinaryCells): string {
  const reply = JSON.parse(command(() => engine_source_bin(JSON.stringify(cells.schema), cells.tags, cells.nums, cells.strs, cells.lens))) as { ok?: string; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  return reply.ok as string;
}

/** Every column of the frame, or the one `column` names; `null` when that column isn't there. */
export function wasmReadBin(handle: string, column?: string, limit?: number): (BinaryCells & { rowCount: number }) | null {
  const reply = JSON.parse(command(() => engine_read_bin(handle, column, limit))) as
    { ok?: { columns: BinaryCells["schema"]; rowCount: number } | null; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  if (!reply.ok) return null;
  const ok = reply.ok;
  return command(() => ({ schema: ok.columns, rowCount: ok.rowCount, tags: take_tags(), nums: take_nums(), strs: take_strs(), lens: take_lens() }));
}

/** A CSV file's text as typed columns (`csv::frame_columnar`): its delimiter guessed, each column's type read off its
 *  cells. */
export function wasmCsvFrame(text: string): BinaryCells & { rowCount: number } {
  const reply = JSON.parse(command(() => engine_csv_frame(text))) as { ok?: { columns: BinaryCells["schema"]; rowCount: number }; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  const ok = reply.ok!;
  return command(() => ({ schema: ok.columns, rowCount: ok.rowCount, tags: take_tags(), nums: take_nums(), strs: take_strs(), lens: take_lens() }));
}

/** Each column's cells read as one type, with its trimmed text as `raw` (`nodes::infer_column`). */
export function wasmInferBin(cells: BinaryCells): BinaryCells {
  const reply = JSON.parse(command(() => engine_infer_bin(JSON.stringify(cells.schema), cells.tags, cells.nums, cells.strs, cells.lens))) as
    { ok?: BinaryCells["schema"]; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  const schema = reply.ok!;
  return command(() => ({ schema, tags: take_tags(), nums: take_nums(), strs: take_strs(), lens: take_lens() }));
}

/** The rows CSV text reads as (`csv::rows_columnar`). */
export function wasmCsvRows(text: string, detect: boolean, keepBlank: boolean): string[][] {
  const reply = JSON.parse(command(() => engine_csv_rows(text, detect, keepBlank))) as { ok?: number; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  const { strs, lens, widths } = command(() => ({ widths: take_nums(), lens: take_lens(), strs: take_strs() }));
  const rows = new Array<string[]>(widths.length);
  let off = 0, li = 0;
  for (let i = 0; i < widths.length; i++) {
    const row = new Array<string>(widths[i]);
    for (let j = 0; j < row.length; j++) { const n = lens[li++]; row[j] = strs.slice(off, off + n); off += n; }
    rows[i] = row;
  }
  return rows;
}
