// [[D102]] graphOnCore
// The editor: a handle over the graph core's Ruggine editor, which holds the nodes, their ports and the cables
// (`crates/solenoid-graph`, tree/specs/computation/graph-core.md § The model). The handle keeps each node's and cable's
// JavaScript object by id, as the core's signals report them.
import { GraphCore } from "./engineWasm/solenoid_graph.js";
import { guarded, onWasmEngineReset, wasmEngineLoaded } from "./engineWasm";
import type { DataflowEngine } from "./dataflowEngine";
import type { GraphNode, GraphSchemes, PortListener } from "./graphModel";
import type { Schemes } from "./schemes";

/** What a fetch rejects with when a reset clears its node mid-run. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

const _live = new Set<WeakRef<GraphEditor<GraphSchemes>>>();
const _portsMoved = new Set<GraphEditor<GraphSchemes>>();

/** Every editor's pending port changes, sent: the core reads a node's ports when the node's `data()` returns. */
export function flushPortEdits(): void {
  for (const editor of [..._portsMoved]) editor.flushPorts();
}

// After a trap every live editor builds its graph again in the fresh instance, on its next call.
onWasmEngineReset(() => {
  for (const ref of _live) {
    const editor = ref.deref();
    if (editor) editor.rebuild();
    else _live.delete(ref);
  }
});

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
  /** Nodes here whose ports changed since the core last heard. */
  private movedPorts = new Set<S["Node"]>();
  /** Set while a rebuilt core takes the graph back: the pipes stay silent. */
  private replaying = false;
  engine?: DataflowEngine<S>;

  constructor() {
    _live.add(new WeakRef(this as unknown as GraphEditor<GraphSchemes>));
    this.piped.push({ run: (signal) => { this.track(signal as GraphSignal<S>); return signal; } });
  }

  /** The core, built on first use (and again after a trap) from what the handle holds; the nodes' port changes
   *  since the last call reach it first. */
  core(): GraphCore {
    if (this._core) {
      if (this.movedPorts.size) this.flushPorts(this._core);
      return this._core;
    }
    this.movedPorts.clear();
    if (!wasmEngineLoaded()) throw new Error("the wasm engine isn't loaded (loadWasmEngine)");
    const core = new GraphCore(Cancelled);
    this._core = core;
    this.replaying = true;
    try {
      for (const p of this.piped) this.install(core, p);
      for (const node of this.nodes.values()) {
        const [ik, it] = portsOf(node.inputs), [ok, ot] = portsOf(node.outputs);
        core.addNode(node.id, node, ik, it, ok, ot);
        this.nest(core, node, true);
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
    if (p.engine) { core.useEngine(this.engine!.raw); return; }
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
        this.nest(this._core!, signal.data, true);
        break;
      case "noderemoved":
        this.nodes.delete(signal.data.id);
        this.nodeList = null;
        signal.data.listen(this, false);
        this.nest(this._core!, signal.data, false);
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

  /** A composite's own editor, made known to this core so a pass can retarget an edit inside it. */
  private nest(core: GraphCore, node: S["Node"], on: boolean): void {
    const inner = (node as unknown as { internalEditor?: unknown }).internalEditor;
    if (!(inner instanceof GraphEditor)) return;
    if (on) core.nest(node.id, inner.core());
    else core.unnest(node.id);
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

  // A node's port changes, while the node is here, reach the core as one call per node, before the next call into
  // it (or a node's `data()` returning, `flushPortEdits`). With no core yet, or a dead one, the core built next reads
  // the node's ports as they stand.
  portsMoved(node: GraphNode): void {
    this.movedPorts.add(node as S["Node"]);
    _portsMoved.add(this as unknown as GraphEditor<GraphSchemes>);
  }

  /** Sends each changed node's ports, as they stand, in one call per node. */
  flushPorts(core: GraphCore | null = this._core): void {
    _portsMoved.delete(this as unknown as GraphEditor<GraphSchemes>);
    if (!core || !wasmEngineLoaded() || this.movedPorts.size === 0) return;
    const moved = [...this.movedPorts];
    this.movedPorts.clear();
    guarded(() => {
      for (const node of moved) {
        if (this.nodes.get(node.id) !== node) continue;
        const [ik, it] = portsOf(node.inputs), [ok, ot] = portsOf(node.outputs);
        core.setPorts(node.id, ik, it, ok, ot);
      }
    });
  }
}
