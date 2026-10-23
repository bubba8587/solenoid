// [[C130]] rustCore
// The Rust frame engine (`crates/solenoid-core`) compiled to WebAssembly: the same commands the desktop
// engine takes over IPC, answered in-process. `npm run build:wasm` regenerates `engineWasm/`.
import init, { initSync, __wbg_reset, engine_invoke, engine_source_bin, engine_read_bin, engine_csv_frame, engine_csv_rows, take_tags, take_nums, take_strs, take_lens } from "./engineWasm/solenoid_core.js";
const wasmUrl = new URL("./engineWasm/solenoid_core_bg.wasm", import.meta.url);
import { toSolError } from "./errorValue";
import type { ColumnUnit } from "./unitValue";
import type { FormatAnnotation } from "./formatAnnotationStore";

let _ready: Promise<boolean> | null = null;
let _loaded = false;

/** Fetches and instantiates the module once; false when the browser can't. */
export function loadWasmEngine(): Promise<boolean> {
  _ready ??= init({ module_or_path: wasmUrl }).then(() => (_loaded = true), () => false);
  return _ready;
}

/** For hosts that hold the module's bytes (tests, Node scripts). */
export function loadWasmEngineSync(bytes: BufferSource): void {
  initSync({ module: bytes });
  _loaded = true;
  _ready = Promise.resolve(true);
}

export function wasmEngineLoaded(): boolean {
  return _loaded;
}

/** Thrown in place of whatever escaped the module (a trap, a stack overflow): the instance is gone, a fresh one is
 *  on its way, and the caller answers on the TS. */
export class CoreTrap extends Error {}

let _generation = 0;
const _onReset = new Set<() => void>();

/** Runs after the module comes back from a trap: whatever named the dead instance's state forgets it. */
export function onWasmEngineReset(f: () => void): void {
  _onReset.add(f);
}

/** A fresh instance of the compiled module. A trap leaves the old one's stack pointer and heap where it stopped, so
 *  every later call could fail; synchronously where the host allows it, else before the next calc. */
function reinstantiate(): void {
  const module = __wbg_reset();
  _loaded = false;
  const gen = ++_generation;
  const ready = () => {
    _loaded = true;
    engine_invoke("engine_handle_base", JSON.stringify({ base: gen * 2 ** 32 }));
    for (const f of _onReset) f();
    return true;
  };
  try {
    initSync({ module });
    _ready = Promise.resolve(ready());
  } catch {
    _ready = init({ module_or_path: module }).then(ready, () => false);
  }
}

function guarded<T>(call: () => T): T {
  if (!_loaded) throw new CoreTrap("the core is reloading");
  try {
    return call();
  } catch (e) {
    reinstantiate();
    throw new CoreTrap(e instanceof Error ? e.message : String(e));
  }
}

/** `run()`, or `fallback` where the core trapped during it. */
export function onCore<T, F>(run: () => T, fallback: F): T | F {
  try {
    return run();
  } catch (e) {
    if (e instanceof CoreTrap) return fallback;
    throw e;
  }
}

export function wasmInvokeSync<T>(command: string, args: Record<string, unknown> = {}): T {
  const reply = JSON.parse(guarded(() => engine_invoke(command, JSON.stringify(args)))) as { ok?: T; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  return reply.ok as T;
}

export async function wasmInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return wasmInvokeSync<T>(command, args);
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
  const reply = JSON.parse(guarded(() => engine_source_bin(JSON.stringify(cells.schema), cells.tags, cells.nums, cells.strs, cells.lens))) as { ok?: string; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  return reply.ok as string;
}

/** Every column of the frame, or the one `column` names; `null` when that column isn't there. */
export function wasmReadBin(handle: string, column?: string, limit?: number): (BinaryCells & { rowCount: number }) | null {
  const reply = JSON.parse(guarded(() => engine_read_bin(handle, column, limit))) as
    { ok?: { columns: BinaryCells["schema"]; rowCount: number } | null; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  if (!reply.ok) return null;
  const ok = reply.ok;
  return guarded(() => ({ schema: ok.columns, rowCount: ok.rowCount, tags: take_tags(), nums: take_nums(), strs: take_strs(), lens: take_lens() }));
}

/** A CSV file's text as typed columns (`csv::frame_columnar`): its delimiter guessed, each column's type read off its
 *  cells. */
export function wasmCsvFrame(text: string): BinaryCells & { rowCount: number } {
  const reply = JSON.parse(guarded(() => engine_csv_frame(text))) as { ok?: { columns: BinaryCells["schema"]; rowCount: number }; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  const ok = reply.ok!;
  return guarded(() => ({ schema: ok.columns, rowCount: ok.rowCount, tags: take_tags(), nums: take_nums(), strs: take_strs(), lens: take_lens() }));
}

/** The rows CSV text reads as (`csv::rows_columnar`). */
export function wasmCsvRows(text: string, detect: boolean, keepBlank: boolean): string[][] {
  const reply = JSON.parse(guarded(() => engine_csv_rows(text, detect, keepBlank))) as { ok?: number; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  const { strs, lens, widths } = guarded(() => ({ widths: take_nums(), lens: take_lens(), strs: take_strs() }));
  const rows = new Array<string[]>(widths.length);
  let off = 0, li = 0;
  for (let i = 0; i < widths.length; i++) {
    const row = new Array<string>(widths[i]);
    for (let j = 0; j < row.length; j++) { const n = lens[li++]; row[j] = strs.slice(off, off + n); off += n; }
    rows[i] = row;
  }
  return rows;
}
