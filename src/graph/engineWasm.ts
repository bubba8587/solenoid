// [[C130]] rustCore
// The Rust frame engine (`crates/solenoid-core`) compiled to WebAssembly: the same commands the desktop
// engine takes over IPC, answered in-process. `npm run build:wasm` regenerates `engineWasm/`.
import init, { initSync, __wbg_reset, engine_invoke, engine_source_bin, engine_read_bin, take_tags, take_nums, take_strs, take_lens } from "./engineWasm/solenoid_core.js";
const wasmUrl = new URL("./engineWasm/solenoid_core_bg.wasm", import.meta.url);
import { toSolError } from "./errorValue";

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

type ExternalCaller = (name: string, empty: string, args: string) => string | undefined;
let _external: ExternalCaller | undefined;

/** What the core calls back for a pack's function (`external.rs`). It's set on the global before each call rather than
 *  once, so the core always reaches the registry of the module copy that called it. */
export function setExternalCaller(f: ExternalCaller): void {
  _external = f;
}

function guarded<T>(call: () => T): T {
  if (!_loaded) throw new CoreTrap("the core is reloading");
  (globalThis as { __solenoidCallExternal?: ExternalCaller }).__solenoidCallExternal = _external;
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
  schema: { name: string; type: string; len: number }[];
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
