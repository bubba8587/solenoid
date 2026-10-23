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
 * One editor's graph and its dataflow engine.
 */
export class GraphCore {
  free(): void;
  /**
   * What a change to `id` reaches, its caches cleared; `undefined` without a node.
   */
  invalidate(id: string | null | undefined, keep_caches: boolean): string[] | undefined;
  /**
   * Attaches the engine here in the chain, registering the nodes already in the editor.
   */
  useEngine(): void;
  /**
   * `false` when a `noderemove` pipe cancelled it.
   */
  removeNode(id: string): boolean;
  removePipe(handle: number): boolean;
  removePort(id: string, output: boolean, key: string): boolean;
  retypePort(id: string, output: boolean, key: string, ty: string): boolean;
  /**
   * The node's inputs, fetching every predecessor.
   */
  fetchInputs(id: string): Promise<any>;
  loopMembers(): string[];
  /**
   * Puts the nodes in `order`, which must name every node once; `false` when it doesn't.
   */
  reorderNodes(order: string[]): boolean;
  /**
   * `false` when a `connectioncreate` pipe cancelled it.
   */
  addConnection(object: any, id: string, source: string, source_output: string, target: string, target_input: string): boolean;
  connectionIds(): string[];
  /**
   * `false` when a `connectionremove` pipe cancelled it.
   */
  removeConnection(id: string): boolean;
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
   * Every cable, then every node; `false` when a `clear` pipe cancelled it.
   */
  clear(): boolean;
  /**
   * The node's outputs, from the cache when present.
   */
  fetch(id: string): Promise<any>;
  /**
   * The node's ports on one side as `[key, type]` pairs, in order; `undefined` for a node not
   * here.
   */
  ports(id: string, output: boolean): Array<any> | undefined;
  /**
   * Clears the node's cache and everything downstream through the outputs it computes;
   * without a node, every cache.
   */
  reset(id?: string | null): void;
  /**
   * Clears the node's cache alone, cancelling a run in flight.
   */
  forget(id: string): void;
  /**
   * `false` when a `nodecreate` pipe cancelled it.
   */
  addNode(id: string, object: object, input_keys: string[], input_types: string[], output_keys: string[], output_types: string[]): boolean;
  /**
   * Adds `pipe(type, data)` after every pipe already here: it answers truthy to go on, falsy to
   * stop the chain (cancelling the change a present-tense signal announces), and what it
   * throws stops the chain and fails the edit. Returns the handle `removePipe` takes.
   */
  addPipe(pipe: Function): number;
  addPort(id: string, output: boolean, key: string, ty: string): void;
  nodeIds(): string[];
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
  readonly graphcore_addConnection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
  readonly graphcore_addNode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
  readonly graphcore_addPipe: (a: number, b: number) => number;
  readonly graphcore_addPort: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
  readonly graphcore_clear: (a: number, b: number) => void;
  readonly graphcore_connectionIds: (a: number, b: number) => void;
  readonly graphcore_downstreamClosure: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_fetch: (a: number, b: number, c: number) => number;
  readonly graphcore_fetchAll: (a: number, b: number, c: number) => number;
  readonly graphcore_fetchInputs: (a: number, b: number, c: number) => number;
  readonly graphcore_forget: (a: number, b: number, c: number) => void;
  readonly graphcore_invalidate: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly graphcore_isCached: (a: number, b: number, c: number) => number;
  readonly graphcore_loopMembers: (a: number, b: number) => void;
  readonly graphcore_new: (a: number) => number;
  readonly graphcore_nodeIds: (a: number, b: number) => void;
  readonly graphcore_ports: (a: number, b: number, c: number, d: number) => number;
  readonly graphcore_removeConnection: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_removeNode: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_removePipe: (a: number, b: number) => number;
  readonly graphcore_removePort: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
  readonly graphcore_reorderNodes: (a: number, b: number, c: number) => number;
  readonly graphcore_reset: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_retypePort: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
  readonly graphcore_seed: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_useEngine: (a: number, b: number) => void;
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
