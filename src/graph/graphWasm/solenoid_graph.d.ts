/* tslint:disable */
/* eslint-disable */
/**
 * `handler(message)` runs when a panic starts, before the module traps, so the host can settle what was waiting on
 * it and instantiate the module afresh.
 */
export function setPanicHandler(handler: Function): void;
/**
 * A node's or cable's id: sixteen lowercase hex digits from eight secure random bytes, Ruggine's `getUID`.
 */
export function uid(): string;
/**
 * Panics: the tests' trigger for the recovery (`graphTrap.test.ts`).
 */
export function graphTrap(): void;
/**
 * A node outside any editor computed on `inputs` through the input boundary, calling `data` (its own `data()` when
 * none): the outputs at once when nothing it does waits, else a promise of them. For tests and scripts that drive one
 * node.
 */
export function computeNode(node: object, inputs: any, data?: Function | null): any;
/**
 * `withGraphRebuild`'s scope: opening clears the topology flag; closing answers `[noneOpen, cableChanged]`.
 */
export function sessionRebuildScope(open: boolean): Array<any>;
export function sessionMarkTopoDirty(): void;
/**
 * A request for a pass: `"gated"` (manual mode marked the graph dirty), `"queued"` (a pass in flight reruns) or
 * `"run"`.
 */
export function sessionEnter(changed: string | null | undefined, force: boolean): string;
/**
 * The pass ended (`finished` when it didn't throw): the rerun it owes as `{ force, exact, changed }`, or `null`.
 */
export function sessionExit(finished: boolean): any;
/**
 * The pass's state as the host caches it: `{ mode, dirty, forceExact, gen, rebuilding, topoDirty, passActive }`.
 */
export function sessionSnapshot(): object;
/**
 * A fresh instance (after a trap) takes back the state the host last saw; the coalesced rerun is gone.
 */
export function sessionRestore(snapshot: object): void;
/**
 * `false` when `mode` is the mode already.
 */
export function sessionSetMode(mode: string): boolean;
/**
 * Sets (`true`) or clears the dirty flag; `true` on a transition.
 */
export function sessionDirty(dirty: boolean): boolean;
/**
 * Opens (`true`) or closes a force-exact bracket.
 */
export function sessionForceExact(begin: boolean): void;
/**
 * A new recalc generation, which every volatile node rolls on.
 */
export function sessionNextGeneration(): number;
/**
 * Opens (`true`) or closes a rebuild scope; closing answers whether none is open after it.
 */
export function sessionRebuild(begin: boolean): boolean;
export function isLazyFrameNode(_class: string): boolean;
export function seesErrors(_class: string): boolean;
/**
 * Installs what the boundary asks the app for; every engine call that runs a node needs it.
 */
export function setBoundaryHost(host: object): void;
export function findCellError(v: any): any;
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
   * Seeds `#CIRC!` on every loop member (with `message`, or the default one) and returns them.
   */
  seedLoops(message?: string | null): string[];
  /**
   * Attaches the engine here in the chain, registering the nodes already in the editor. A `raw` engine calls each
   * node's `data()` as it is; any other runs it through the input boundary.
   */
  useEngine(raw: boolean): void;
  /**
   * The model pass (`computeAll`): what `changed` reaches cleared (every cache without it), the loops seeded,
   * every node fetched. A `Map` of each node's outputs, `null` for one a reset cancelled.
   */
  computeAll(changed?: string | null): Promise<any>;
  /**
   * Marks every composite holding `id` (at any depth) as edited inside; the outermost one's id, or `undefined`
   * when no composite here holds it.
   */
  markNested(id: string): string | undefined;
  /**
   * `false` when a `noderemove` pipe cancelled it.
   */
  removeNode(id: string): boolean;
  removePipe(handle: number): boolean;
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
   * `id` is a composite node here whose own editor's core is `inner`.
   */
  nest(id: string, inner: GraphCore): void;
  /**
   * The app's pass body ([[compute-pass]] § The pass body): `changed` retargeted to the composite holding it,
   * what it reaches cleared (a full pass clears everything; an additive one, `render_only`, nothing), the loop set
   * (reused by a value edit's targeted pass) seeded, every node fetched in the editor's order with `on_node(id,
   * outputs)` answering whether its outputs changed. The nodes to re-render, in order; `null` when a reset
   * cancelled the pass.
   */
  pass(changed: string | null | undefined, render_only: string[] | null | undefined, topology: boolean, on_node: Function): Promise<any>;
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
  unnest(id: string): void;
  /**
   * The node computed on `inputs` (one list per input key) as the engine computes it, without its cache.
   */
  compute(id: string, inputs: any): Promise<any>;
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
  nodeIds(): string[];
  /**
   * Every node's outputs in the editor's order, as a `Map`; `null` when `stop_on_cancel` and
   * a reset cancelled the pass. `on_node(id, outputs)` runs as each node lands.
   */
  fetchAll(on_node: Function | null | undefined, stop_on_cancel: boolean): Promise<any>;
  isCached(id: string): boolean;
  /**
   * Gives the node exactly these ports, in order: a node's socket changes reach the core as one call.
   */
  setPorts(id: string, input_keys: string[], input_types: string[], output_keys: string[], output_types: string[]): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_graphcore_free: (a: number, b: number) => void;
  readonly computeNode: (a: number, b: number, c: number, d: number) => void;
  readonly findCellError: (a: number) => number;
  readonly graphTrap: () => void;
  readonly graphcore_addConnection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
  readonly graphcore_addNode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
  readonly graphcore_addPipe: (a: number, b: number) => number;
  readonly graphcore_clear: (a: number, b: number) => void;
  readonly graphcore_compute: (a: number, b: number, c: number, d: number) => number;
  readonly graphcore_computeAll: (a: number, b: number, c: number) => number;
  readonly graphcore_connectionIds: (a: number, b: number) => void;
  readonly graphcore_downstreamClosure: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_fetch: (a: number, b: number, c: number) => number;
  readonly graphcore_fetchAll: (a: number, b: number, c: number) => number;
  readonly graphcore_fetchInputs: (a: number, b: number, c: number) => number;
  readonly graphcore_forget: (a: number, b: number, c: number) => void;
  readonly graphcore_invalidate: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly graphcore_isCached: (a: number, b: number, c: number) => number;
  readonly graphcore_loopMembers: (a: number, b: number) => void;
  readonly graphcore_markNested: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_nest: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_new: (a: number) => number;
  readonly graphcore_nodeIds: (a: number, b: number) => void;
  readonly graphcore_pass: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly graphcore_ports: (a: number, b: number, c: number, d: number) => number;
  readonly graphcore_removeConnection: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_removeNode: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_removePipe: (a: number, b: number) => number;
  readonly graphcore_reorderNodes: (a: number, b: number, c: number) => number;
  readonly graphcore_reset: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_seed: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_seedLoops: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_setPorts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
  readonly graphcore_unnest: (a: number, b: number, c: number) => void;
  readonly graphcore_useEngine: (a: number, b: number, c: number) => void;
  readonly isLazyFrameNode: (a: number, b: number) => number;
  readonly seesErrors: (a: number, b: number) => number;
  readonly sessionDirty: (a: number) => number;
  readonly sessionEnter: (a: number, b: number, c: number, d: number) => void;
  readonly sessionExit: (a: number) => number;
  readonly sessionForceExact: (a: number) => void;
  readonly sessionMarkTopoDirty: () => void;
  readonly sessionNextGeneration: () => number;
  readonly sessionRebuild: (a: number) => number;
  readonly sessionRebuildScope: (a: number) => number;
  readonly sessionRestore: (a: number) => void;
  readonly sessionSetMode: (a: number, b: number) => number;
  readonly sessionSnapshot: () => number;
  readonly setBoundaryHost: (a: number, b: number) => void;
  readonly setPanicHandler: (a: number) => void;
  readonly uid: (a: number) => void;
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
