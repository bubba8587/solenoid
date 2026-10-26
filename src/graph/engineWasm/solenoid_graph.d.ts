/* tslint:disable */
/* eslint-disable */
/**
 * Off, every card's `data()` runs in JavaScript, its body crossing through `nodeOnCore`: how the node recorder
 * (`FREEZE_NODES`) sees every call the suite makes.
 */
export function setDirectCalls(on: boolean): void;
/**
 * On, every full clear checks that no direct card's call changed with its node unnamed (`unnamedEdits`).
 */
export function auditNamedEdits(on: boolean): void;
/**
 * The cards whose call changed with their node unnamed, as "Class label", since the last ask.
 */
export function unnamedEdits(): string[];
/**
 * `handler(message)` runs when a panic starts, before the module traps, so the host can settle what was waiting on
 * it and instantiate the module afresh.
 */
export function setPanicHandler(handler: Function): void;
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
 * A node's or cable's id: sixteen lowercase hex digits from eight secure random bytes, Ruggine's `getUID`.
 */
export function uid(): string;
/**
 * The socket lattice as the tables the app reads (`lattice::tables_json`).
 */
export function latticeTables(): string;
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
 * The classes the engine calls in Rust (`nodes::DIRECT`), for `directBodies.test.ts`.
 */
export function directBodies(): string[];
/**
 * The direct classes that hand on in TypeScript what the core can't hold (`nodes::OFF_CORE`).
 */
export function offCoreBodies(): string[];
export function isLazyFrameNode(_class: string): boolean;
export function seesErrors(_class: string): boolean;
/**
 * Installs what the boundary asks the app for; every engine call that runs a node needs it.
 */
export function setBoundaryHost(host: object): void;
export function findCellError(v: any): any;
/**
 * `{"ok": result}` or `{"err": {"__solError", code, message}}`, as JSON text.
 */
export function engine_invoke(command: string, args: string): string;
export function engine_source_bin(schema: string, tags: Uint8Array, nums: Float64Array, strs: string, lens: Uint32Array): string;
/**
 * Stages a frame's cells for the `take_*` calls and answers its schema: every column, or the one
 * `column` names (`get_column`; `null` when none), each cut to `limit` cells when it's set.
 */
export function engine_read_bin(handle: string, column?: string | null, limit?: number | null): string;
/**
 * Stages `csvToFrame`'s typed columns for the `take_*` calls and answers their schema (`csv::frame_columnar`).
 */
export function engine_csv_frame(text: string): string;
/**
 * The "Decimal places" and "Scientific from" settings every unformatted number shows by; the app sets them on load
 * and on each change.
 */
export function display_settings(number_decimals?: number | null, sci_above?: string | null): void;
/**
 * A number nobody formatted, as the Format Controller's General style shows it.
 */
export function fmt_scalar(n: number): string;
/**
 * A number as a format annotation (its JSON) shows it.
 */
export function fmt_annotated(n: number, annotation: string): string;
/**
 * A date serial in a `YYYY-MM-DD`-style pattern.
 */
export function fmt_date(serial: number, pattern: string): string;
/**
 * Whether a card cell's text is a hex colour, as the Cards view draws it.
 */
export function card_is_hex_color(text: string): boolean;
/**
 * The address a card cell's text links to, if any.
 */
export function card_link_href(text: string): string | undefined;
/**
 * The image a Record cell's text shows, if any ([[C103]] untrustedContentSeams).
 */
export function card_image_src(text: string): string | undefined;
/**
 * Text as a number: plain decimal or scientific, or thousands grouped by commas; NaN otherwise.
 */
export function read_decimal(text: string): number;
/**
 * Text as a logical: 1 for TRUE, 0 for FALSE, NaN when it doesn't read as one, and `undefined` for blank.
 */
export function read_logical(text: string): number | undefined;
/**
 * Stages `inferColumn`'s reading of each column of a frame's cells for the `take_*` calls and answers its schema
 * (`nodes::infer_cells`). A text column comes back empty: its cells are the trimmed text the caller sent. The schema
 * is written as text, since a table of thousands of short columns spends more on building JSON values than on
 * reading its cells.
 */
export function engine_infer_bin(schema: string, tags: Uint8Array, nums: Float64Array, strs: string, lens: Uint32Array): string;
/**
 * Stages `parseCsvRows`'s fields for the `take_*` calls (`csv::rows_columnar`) and answers how many rows they make.
 */
export function engine_csv_rows(text: string, detect: boolean, keep_blank: boolean): string;
/**
 * Holds a big input of `engine_node`'s next call, a frame or a list as buffers (`nodes::columnar`); its id, which the
 * call names as `{"__staged": id}`.
 */
export function card_stage(kind: string, schema: string | null | undefined, tags: Uint8Array, nums: Float64Array, strs: string, lens: Uint32Array): number;
/**
 * Stages the answer `engine_node`'s reply named `{"staged": id}` for the `take_*` calls; its kind and schema as JSON
 * (`{"kind", "schema"}`), or null where it was taken already.
 */
export function card_unstage(id: number): string | undefined;
export function take_tags(): Uint8Array;
export function take_nums(): Float64Array;
export function take_strs(): string;
export function take_lens(): Uint32Array;
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
  conduitPath(cable_id: string): string | undefined;
  /**
   * The node's inputs, fetching every predecessor.
   */
  fetchInputs(id: string): Promise<any>;
  loopMembers(): string[];
  /**
   * The Type Settle over this editor (`settle.rs`): `facts` is each node's, as `settleFacts.ts` writes them, and the
   * order and cables are the graph's. Answers `{ changes: [[id, "in" | "out", key, type]], conduitChanged, adopted }`.
   */
  settleTypes(facts: string): string;
  /**
   * The output an output's value comes from, through every Conduit lane: `[node, output]` (`conduit.rs`).
   */
  typedSource(id: string, key: string): string[];
  /**
   * The Format Controller reconcile over this graph, from each node's facts (`fcFacts.ts`): `fc::reconcile`'s
   * answer as JSON.
   */
  reconcileFcs(facts: string): string;
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
   * `cancelled` is the class of error a fetch cut short by a reset rejects with; `adopt(node, field)` makes the
   * object read a field the core holds for it (`GraphEditor.adopt`).
   */
  constructor(cancelled: Function, adopt: Function);
  /**
   * `id` is a composite node here whose own editor's core is `inner`.
   */
  nest(id: string, inner: GraphCore): void;
  /**
   * The app's pass body (compute-pass.md § The pass body): `changed` retargeted to the composite holding it,
   * what it reaches cleared (a full pass clears everything; an additive one, `render_only`, nothing), the loop set
   * (reused by a value edit's targeted pass) seeded, every node fetched in the editor's order and landed (its
   * outputs held for the cable readouts, the change test against what it landed before). The nodes to re-render, in
   * order; `null` when a reset cancelled the pass.
   */
  pass(changed: string | null | undefined, render_only: string[] | null | undefined, topology: boolean): Promise<any>;
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
   * The node changed in place (a field, a literal, a label), here or inside a composite here: its call is read
   * afresh on its next compute. `false` when no editor here holds it.
   */
  named(id: string): boolean;
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
   * A field the core holds for a direct card (`cachedResult` and the rest); `undefined` where it holds none.
   */
  shown(id: string, field: string): any;
  /**
   * Clears the node's cache alone, cancelling a run in flight.
   */
  forget(id: string): void;
  /**
   * The output `key` of node `id` as the last pass landed it; `undefined` before one did.
   */
  landed(id: string, key: string): any;
  unnest(id: string): void;
  /**
   * The node computed on `inputs` (one list per input key) as the engine computes it, without its cache.
   */
  compute(id: string, inputs: any): Promise<any>;
  /**
   * Every node's fields the core held go back to its object, so the editor can free this core and build another
   * from its objects when it's used again (`GraphEditor.dispose`).
   */
  release(): void;
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
  /**
   * The run a cable belongs to (`conduit.rs`), as `{ connIds, origin: [node, output], terminals: [[node, input]],
   * conduits }`; `undefined` for a cable not here.
   * Every port's format annotation and every node's value origin over this graph, from each node's facts
   * (`annotationFacts.ts`): `annotate::resolve_all`'s answer as JSON.
   */
  annotate(facts: string): string;
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
  /**
   * JavaScript wrote a field the core holds for a direct card; `false` where it holds none for it.
   */
  setShown(id: string, field: string, value: any): boolean;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_graphcore_free: (a: number, b: number) => void;
  readonly auditNamedEdits: (a: number) => void;
  readonly computeNode: (a: number, b: number, c: number, d: number) => void;
  readonly directBodies: (a: number) => void;
  readonly findCellError: (a: number) => number;
  readonly graphTrap: () => void;
  readonly graphcore_addConnection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
  readonly graphcore_addNode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
  readonly graphcore_addPipe: (a: number, b: number) => number;
  readonly graphcore_annotate: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_clear: (a: number, b: number) => void;
  readonly graphcore_compute: (a: number, b: number, c: number, d: number) => number;
  readonly graphcore_computeAll: (a: number, b: number, c: number) => number;
  readonly graphcore_conduitPath: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_connectionIds: (a: number, b: number) => void;
  readonly graphcore_downstreamClosure: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_fetch: (a: number, b: number, c: number) => number;
  readonly graphcore_fetchAll: (a: number, b: number, c: number) => number;
  readonly graphcore_fetchInputs: (a: number, b: number, c: number) => number;
  readonly graphcore_forget: (a: number, b: number, c: number) => void;
  readonly graphcore_invalidate: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly graphcore_isCached: (a: number, b: number, c: number) => number;
  readonly graphcore_landed: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly graphcore_loopMembers: (a: number, b: number) => void;
  readonly graphcore_markNested: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_named: (a: number, b: number, c: number) => number;
  readonly graphcore_nest: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_new: (a: number, b: number) => number;
  readonly graphcore_nodeIds: (a: number, b: number) => void;
  readonly graphcore_pass: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
  readonly graphcore_ports: (a: number, b: number, c: number, d: number) => number;
  readonly graphcore_reconcileFcs: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_release: (a: number) => void;
  readonly graphcore_removeConnection: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_removeNode: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_removePipe: (a: number, b: number) => number;
  readonly graphcore_reorderNodes: (a: number, b: number, c: number) => number;
  readonly graphcore_reset: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_seed: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_seedLoops: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_setPorts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
  readonly graphcore_setShown: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
  readonly graphcore_settleTypes: (a: number, b: number, c: number, d: number) => void;
  readonly graphcore_shown: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly graphcore_typedSource: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly graphcore_unnest: (a: number, b: number, c: number) => void;
  readonly graphcore_useEngine: (a: number, b: number, c: number) => void;
  readonly isLazyFrameNode: (a: number, b: number) => number;
  readonly latticeTables: (a: number) => void;
  readonly offCoreBodies: (a: number) => void;
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
  readonly setDirectCalls: (a: number) => void;
  readonly setPanicHandler: (a: number) => void;
  readonly uid: (a: number) => void;
  readonly unnamedEdits: (a: number) => void;
  readonly card_image_src: (a: number, b: number, c: number) => void;
  readonly card_is_hex_color: (a: number, b: number) => number;
  readonly card_link_href: (a: number, b: number, c: number) => void;
  readonly card_stage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
  readonly card_unstage: (a: number, b: number) => void;
  readonly display_settings: (a: number, b: number, c: number, d: number) => void;
  readonly engine_csv_frame: (a: number, b: number, c: number) => void;
  readonly engine_csv_rows: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly engine_infer_bin: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
  readonly engine_invoke: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly engine_read_bin: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly engine_source_bin: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
  readonly fmt_annotated: (a: number, b: number, c: number, d: number) => void;
  readonly fmt_date: (a: number, b: number, c: number, d: number) => void;
  readonly fmt_scalar: (a: number, b: number) => void;
  readonly read_decimal: (a: number, b: number) => number;
  readonly read_logical: (a: number, b: number, c: number) => void;
  readonly take_lens: (a: number) => void;
  readonly take_nums: (a: number) => void;
  readonly take_strs: (a: number) => void;
  readonly take_tags: (a: number) => void;
  readonly __wbindgen_export_0: (a: number) => void;
  readonly __wbindgen_export_1: (a: number, b: number) => number;
  readonly __wbindgen_export_2: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_3: WebAssembly.Table;
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
