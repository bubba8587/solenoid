/* tslint:disable */
/* eslint-disable */
/**
 * `handler(message)` runs when a panic starts, before the module traps, so the host can settle what was waiting on
 * it and instantiate the module afresh.
 */
export function setPanicHandler(handler: Function): void;
/**
 * Panics: the tests' trigger for the recovery (`graphTrap.test.ts`).
 */
export function graphTrap(): void;
/**
 * One editor's mirror and its dataflow engine.
 */
export class GraphCore {
  free(): void;
  /**
   * What a change to `id` reaches, its caches cleared; `undefined` without a node.
   */
  invalidate(id: string | null | undefined, keep_caches: boolean): string[] | undefined;
  removeNode(id: string): void;
  /**
   * The node's inputs, fetching every predecessor.
   */
  fetchInputs(id: string): Promise<any>;
  loopMembers(): string[];
  addConnection(id: string, source: string, source_output: string, target: string, target_input: string): void;
  removeConnection(id: string): void;
  downstreamClosure(id: string): string[];
  /**
   * `cancelled` is the class of error a fetch cut short by a reset rejects with.
   */
  constructor(cancelled: Function);
  /**
   * Gives the node `outputs` without running it, until something clears its cache.
   */
  seed(id: string, outputs: any): void;
  /**
   * The node's outputs, from the cache when present.
   */
  fetch(id: string): Promise<any>;
  /**
   * Clears the node's cache and everything downstream through the outputs it computes;
   * without a node, every cache.
   */
  reset(id?: string | null): void;
  /**
   * Clears the node's cache alone, cancelling a run in flight.
   */
  forget(id: string): void;
  addNode(id: string, object: object): void;
  /**
   * Every node's outputs in the editor's order, as a `Map`; `null` when `stop_on_cancel` and
   * a reset cancelled the pass. `on_node(id, outputs)` runs as each node lands.
   */
  fetchAll(on_node: Function | null | undefined, stop_on_cancel: boolean): Promise<any>;
  isCached(id: string): boolean;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_graphcore_free: (a: number, b: number) => void;
  readonly graphTrap: () => void;
  readonly graphcore_addConnection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
  readonly graphcore_addNode: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly graphcore_downstreamClosure: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_fetch: (a: number, b: number, c: number) => number;
  readonly graphcore_fetchAll: (a: number, b: number, c: number) => number;
  readonly graphcore_fetchInputs: (a: number, b: number, c: number) => number;
  readonly graphcore_forget: (a: number, b: number, c: number) => void;
  readonly graphcore_invalidate: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly graphcore_isCached: (a: number, b: number, c: number) => number;
  readonly graphcore_loopMembers: (a: number, b: number) => void;
  readonly graphcore_new: (a: number) => number;
  readonly graphcore_removeConnection: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_removeNode: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_reset: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_seed: (a: number, b: number, c: number, d: number) => void;
  readonly setPanicHandler: (a: number) => void;
  readonly __wbindgen_export_0: (a: number) => void;
  readonly __wbindgen_export_1: WebAssembly.Table;
  readonly __wbindgen_export_2: (a: number, b: number) => number;
  readonly __wbindgen_export_3: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export_4: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export_5: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export_6: (a: number, b: number, c: number, d: number) => void;
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
