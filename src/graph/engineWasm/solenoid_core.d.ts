/* tslint:disable */
/* eslint-disable */
/**
 * `{"ok": result}` or `{"err": {"__solError", code, message}}`, as JSON text.
 */
export function engine_invoke(command: string, args: string): string;
export function engine_source_bin(schema: string, tags: Uint8Array, nums: Float64Array, strs: string, lens: Uint32Array): string;
/**
 * Stages a frame's cells for the `take_*` calls and answers its schema: every column, or the one
 * `column` names by `getColumn` rules (`null` when none), each cut to `limit` cells when it's set.
 */
export function engine_read_bin(handle: string, column?: string | null, limit?: number | null): string;
export function take_tags(): Uint8Array;
export function take_nums(): Float64Array;
export function take_strs(): string;
export function take_lens(): Uint32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly engine_invoke: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly engine_read_bin: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly engine_source_bin: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
  readonly take_lens: (a: number) => void;
  readonly take_nums: (a: number) => void;
  readonly take_strs: (a: number) => void;
  readonly take_tags: (a: number) => void;
  readonly __wbindgen_export_0: (a: number) => void;
  readonly __wbindgen_export_1: (a: number, b: number) => number;
  readonly __wbindgen_export_2: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export_3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
export function __wbg_reset(): WebAssembly.Module;
