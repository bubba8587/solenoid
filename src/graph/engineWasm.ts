// [[C16]] polarsEngine
// The Rust frame engine (`crates/solenoid-core`) compiled to WebAssembly: the same commands the desktop
// engine takes over IPC, answered in-process. `npm run build:wasm` regenerates `engineWasm/`.
import init, { initSync, engine_invoke } from "./engineWasm/solenoid_core.js";
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
