// [[C130]] rustCore
// The Rust frame engine (`crates/solenoid-core`) compiled to WebAssembly: the same commands the desktop
// engine takes over IPC, answered in-process. `npm run build:wasm` regenerates `engineWasm/`.
import init, { initSync, engine_invoke, engine_source_bin, engine_read_bin, take_tags, take_nums, take_strs, take_lens } from "./engineWasm/solenoid_core.js";
import wasmUrl from "./engineWasm/solenoid_core_bg.wasm?url";
import { toSolError } from "./ipcBridge";

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

export function wasmInvokeSync<T>(command: string, args: Record<string, unknown> = {}): T {
  const reply = JSON.parse(engine_invoke(command, JSON.stringify(args))) as { ok?: T; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  return reply.ok as T;
}

export async function wasmInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return wasmInvokeSync<T>(command, args);
}

/** A frame's cells in the engine's columnar hand-off (crates/solenoid-core/src/binary.rs). */
export interface BinaryCells {
  schema: { name: string; type: string; len: number }[];
  tags: Uint8Array;
  nums: Float64Array;
  strs: string;
  lens: Uint32Array;
}

export function wasmSourceBin(cells: BinaryCells): string {
  const reply = JSON.parse(engine_source_bin(JSON.stringify(cells.schema), cells.tags, cells.nums, cells.strs, cells.lens)) as { ok?: string; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  return reply.ok as string;
}

/** Every column of the frame, or the one `column` names; `null` when that column isn't there. */
export function wasmReadBin(handle: string, column?: string, limit?: number): (BinaryCells & { rowCount: number }) | null {
  const reply = JSON.parse(engine_read_bin(handle, column, limit)) as
    { ok?: { columns: BinaryCells["schema"]; rowCount: number } | null; err?: unknown };
  if ("err" in reply) throw toSolError(reply.err);
  if (!reply.ok) return null;
  return { schema: reply.ok.columns, rowCount: reply.ok.rowCount, tags: take_tags(), nums: take_nums(), strs: take_strs(), lens: take_lens() };
}
