// [[D102]] graphOnCore
// The editor: a handle over the graph core's Ruggine editor, which holds the nodes, their ports and the cables
// (`crates/solenoid-graph`, tree/specs/computation/graph-core.md § The model). The handle keeps each node's and cable's
// JavaScript object by id, as the core's signals report them. `npm run build:wasm` regenerates `graphWasm/`.
import init, { initSync, GraphCore, setPanicHandler, __wbg_reset } from "./graphWasm/solenoid_graph.js";
import type { DataflowEngine } from "./dataflowEngine";
import type { GraphNode, GraphSchemes, PortListener } from "./graphModel";
import type { Schemes } from "./schemes";

/** The compiled module's location: a URL Vite bundles, and a `file:` URL under Node. */
export const graphWasmUrl = new URL("./graphWasm/solenoid_graph_bg.wasm", import.meta.url);

let _ready: Promise<void> | null = null;
let _loaded = false;

/** Fetches and instantiates the module once. Nothing computes without it, so the app's first render waits. */
export function loadGraphEngine(): Promise<void> {
  _ready ??= init({ module_or_path: graphWasmUrl }).then(onLoaded);
  return _ready;
}

/** For hosts that hold the module's bytes (tests, Node scripts). */
export function loadGraphEngineSync(bytes: BufferSource): void {
  initSync({ module: bytes });
  onLoaded();
  _ready = Promise.resolve();
}

export function graphEngineLoaded(): boolean {
  return _loaded;
}

function onLoaded(): void {
  _loaded = true;
  setPanicHandler(onPanic);
}

/** What a fetch rejects with when a reset clears its node mid-run. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

/** What a call into the graph core rejects or throws with when the core trapped during it. */
export class GraphTrap extends Error {}

const _live = new Set<WeakRef<GraphEditor<GraphSchemes>>>();
const _pending = new Set<(e: unknown) => void>();
let _dead = false;

/** A panic starts: whatever awaits the core rejects, and once the stack has left the module, a fresh instance
 *  takes over and every live editor rebuilds its graph in it. The engine's caches start empty. */
function onPanic(message: string): void {
  trapped(new GraphTrap(message));
}

function trapped(error: GraphTrap): void {
  if (_dead) return;
  _dead = true;
  for (const reject of _pending) reject(error);
  _pending.clear();
  queueMicrotask(recover);
}

function recover(): void {
  const module = __wbg_reset();
  initSync({ module });
  setPanicHandler(onPanic);
  _dead = false;
  for (const ref of _live) {
    const editor = ref.deref();
    if (editor) editor.rebuild();
    else _live.delete(ref);
  }
}

/** `call()`; a trap during it throws `GraphTrap`. */
export function guarded<T>(call: () => T): T {
  if (_dead) throw new GraphTrap("the graph core is reloading");
  try {
    return call();
  } catch (e) {
    if (_dead || e instanceof WebAssembly.RuntimeError) {
      const trap = new GraphTrap(e instanceof Error ? e.message : String(e));
      trapped(trap);
      throw trap;
    }
    throw e;
  }
}

/** The core's promise, rejecting with `GraphTrap` if the core traps before it settles. */
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

/** What an editor's pipes hear, in rete's shape. */
export type GraphSignal<S extends GraphSchemes> =
  | { type: "nodecreate" | "nodecreated" | "noderemove" | "noderemoved"; data: S["Node"] }
  | { type: "connectioncreate" | "connectioncreated" | "connectionremove" | "connectionremoved"; data: S["Connection"] }
  | { type: "clear" | "clearcancelled" | "cleared" };

/** Returns the signal to go on, or nothing to stop the chain (cancelling a change a present-tense signal announces). */
export type GraphPipe<S extends GraphSchemes> = (signal: GraphSignal<S>) => GraphSignal<S> | undefined | void;

/** A pipe in the chain, or the engine's place in it; `handle` is the core's. */
type Piped = { run?(signal: GraphSignal<GraphSchemes>): unknown; engine?: true; handle?: number; removed?: boolean };

function portsOf(ports: Record<string, { socket: { name: string } } | undefined>): [string[], string[]] {
  const keys = Object.keys(ports);
  return [keys, keys.map((k) => ports[k]!.socket.name)];
}

export class GraphEditor<S extends GraphSchemes = Schemes> implements PortListener {
  private _core: GraphCore | null = null;
  private nodes = new Map<string, S["Node"]>();
  private connections = new Map<string, S["Connection"]>();
  private nodeList: S["Node"][] | null = [];
  private connectionList: S["Connection"][] | null = [];
  private piped: Piped[] = [];
  /** Set while a rebuilt core takes the graph back: the pipes stay silent. */
  private replaying = false;
  engine?: DataflowEngine<S>;

  constructor() {
    _live.add(new WeakRef(this as unknown as GraphEditor<GraphSchemes>));
    this.piped.push({ run: (signal) => { this.track(signal as GraphSignal<S>); return signal; } });
  }

  /** The core, built on first use (and again after a trap) from what the handle holds. */
  core(): GraphCore {
    if (this._core) return this._core;
    if (!_loaded) throw new Error("the graph engine isn't loaded (loadGraphEngine)");
    const core = new GraphCore(Cancelled);
    this._core = core;
    this.replaying = true;
    try {
      for (const p of this.piped) this.install(core, p);
      for (const node of this.nodes.values()) {
        const [ik, it] = portsOf(node.inputs), [ok, ot] = portsOf(node.outputs);
        core.addNode(node.id, node, ik, it, ok, ot);
      }
      for (const c of this.connections.values()) this.sendConnection(core, c);
    } finally {
      this.replaying = false;
    }
    return core;
  }

  /** After a trap: the next call builds a core in the fresh instance. */
  rebuild(): void {
    this._core = null;
  }

  private install(core: GraphCore, p: Piped): void {
    if (p.removed) return;
    if (p.engine) { core.useEngine(); return; }
    const run = p.run!;
    p.handle = core.addPipe((type: string, data: unknown) =>
      this.replaying || run((data === undefined ? { type } : { type, data }) as GraphSignal<GraphSchemes>) != null);
  }

  private track(signal: GraphSignal<S>): void {
    switch (signal.type) {
      case "nodecreated":
        this.nodes.set(signal.data.id, signal.data);
        this.nodeList = null;
        signal.data.listen(this, true);
        break;
      case "noderemoved":
        this.nodes.delete(signal.data.id);
        this.nodeList = null;
        signal.data.listen(this, false);
        break;
      case "connectioncreated":
        this.connections.set(signal.data.id, signal.data);
        this.connectionList = null;
        break;
      case "connectionremoved":
        this.connections.delete(signal.data.id);
        this.connectionList = null;
        break;
    }
  }

  private sendConnection(core: GraphCore, c: S["Connection"]): boolean {
    return core.addConnection(c, c.id, c.source, c.sourceOutput, c.target, c.targetInput);
  }

  getNode(id: string): S["Node"] | undefined {
    return this.nodes.get(id);
  }

  getNodes(): S["Node"][] {
    this.nodeList ??= [...this.nodes.values()];
    return this.nodeList.slice();
  }

  getConnection(id: string): S["Connection"] | undefined {
    return this.connections.get(id);
  }

  getConnections(): S["Connection"][] {
    this.connectionList ??= [...this.connections.values()];
    return this.connectionList.slice();
  }

  /** `false` when a `nodecreate` pipe cancelled it. */
  async addNode(node: S["Node"]): Promise<boolean> {
    const [ik, it] = portsOf(node.inputs), [ok, ot] = portsOf(node.outputs);
    return guarded(() => this.core().addNode(node.id, node, ik, it, ok, ot));
  }

  /** `false` when a `noderemove` pipe cancelled it. */
  async removeNode(id: string): Promise<boolean> {
    return guarded(() => this.core().removeNode(id));
  }

  /** `false` when a `connectioncreate` pipe cancelled it. */
  async addConnection(connection: S["Connection"]): Promise<boolean> {
    return guarded(() => this.sendConnection(this.core(), connection));
  }

  /** `false` when a `connectionremove` pipe cancelled it. */
  async removeConnection(id: string): Promise<boolean> {
    return guarded(() => this.core().removeConnection(id));
  }

  /** Removes every cable, then every node; `false` when a `clear` pipe cancelled it. */
  async clear(): Promise<boolean> {
    return guarded(() => this.core().clear());
  }

  /** Puts the nodes in `order` (the stacking order RF draws and the save keeps), which must name every node once;
   *  `false`, and nothing moved, when it doesn't. No signal is sent. */
  reorderNodes(order: readonly string[]): boolean {
    if (!guarded(() => this.core().reorderNodes([...order]))) return false;
    const byId = this.nodes;
    this.nodes = new Map(order.map((id) => [id, byId.get(id)!]));
    this.nodeList = null;
    return true;
  }

  /** Adds `pipe` after every pipe already here; returns the handle `removePipe` takes. */
  addPipe(pipe: GraphPipe<S>): number {
    const p: Piped = { run: pipe as Piped["run"] };
    this.piped.push(p);
    if (this._core) guarded(() => this.install(this._core!, p));
    return this.piped.length - 1;
  }

  /** Takes a pipe `addPipe` added out of the chain. */
  removePipe(handle: number): void {
    const p = this.piped[handle];
    if (!p || handle === 0 || p.engine || p.removed) return;
    p.removed = true;
    if (this._core && p.handle !== undefined) guarded(() => this._core!.removePipe(p.handle!));
  }

  /** Attaches the engine here in the chain. */
  use(engine: DataflowEngine<S>): void {
    if (this.engine) throw new Error("this editor already has an engine");
    this.engine = engine;
    const p: Piped = { engine: true };
    this.piped.push(p);
    engine.attach(this);
    if (this._core) guarded(() => this.install(this._core!, p));
  }

  /** The node's ports on one side as the core holds them: `[key, socket type]` in order. For tests. */
  corePorts(id: string, output: boolean): [string, string][] | undefined {
    return guarded(() => this.core().ports(id, output)) as [string, string][] | undefined;
  }

  /** The core's node and cable ids, in order. For tests. */
  coreIds(): { nodes: string[]; connections: string[] } {
    return guarded(() => ({ nodes: this.core().nodeIds(), connections: this.core().connectionIds() }));
  }

  // A node's port changes, while the node is here. With no core yet, or a dead one, the core built next reads the
  // node's ports as they stand.
  portAdded(node: GraphNode, output: boolean, key: string, type: string): void {
    if (this._core && !_dead) guarded(() => this._core!.addPort(node.id, output, key, type));
  }

  portRemoved(node: GraphNode, output: boolean, key: string): void {
    if (this._core && !_dead) guarded(() => this._core!.removePort(node.id, output, key));
  }

  portRetyped(node: GraphNode, output: boolean, key: string, type: string): void {
    if (this._core && !_dead) guarded(() => this._core!.retypePort(node.id, output, key, type));
  }
}
