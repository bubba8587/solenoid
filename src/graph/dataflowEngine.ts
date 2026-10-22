// [[D102]] graphOnCore
// The dataflow engine, on the Rust graph core (`crates/solenoid-graph`, Ruggine's port of rete-engine). A plugin under
// the rete editor, as rete-engine's was: it mirrors the editor's nodes and cables into the core, which calls each
// node's own `data()` back. `npm run build:wasm` regenerates `graphWasm/`.
import { NodeEditor, Scope, type Root } from "rete";
import init, { initSync, GraphCore } from "./graphWasm/solenoid_graph.js";
import wasmUrl from "./graphWasm/solenoid_graph_bg.wasm?url";
import type { Schemes } from "./schemes";

let _ready: Promise<void> | null = null;
let _loaded = false;

/** Fetches and instantiates the module once. Nothing computes without it, so the app's first render waits. */
export function loadGraphEngine(): Promise<void> {
  _ready ??= init({ module_or_path: wasmUrl }).then(() => { _loaded = true; });
  return _ready;
}

/** For hosts that hold the module's bytes (tests, Node scripts). */
export function loadGraphEngineSync(bytes: BufferSource): void {
  initSync({ module: bytes });
  _loaded = true;
  _ready = Promise.resolve();
}

export function graphEngineLoaded(): boolean {
  return _loaded;
}

/** What a fetch rejects with when a reset clears its node mid-run. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

const _engines = new WeakMap<object, DataflowEngine<Schemes>>();

/** The engine an editor uses: the graph walks live there, beside the mirror they walk. */
export function engineOf(editor: NodeEditor<Schemes>): DataflowEngine<Schemes> {
  const engine = _engines.get(editor);
  if (!engine) throw new Error("this editor has no DataflowEngine");
  return engine;
}

export type NodeOutputs = Record<string, unknown>;

/** A node the engine computes: its `data()` gets one list per wired input key. */
export type DataflowNode = {
  data(inputs: Record<string, unknown[]>): Promise<NodeOutputs> | NodeOutputs;
};

export class DataflowEngine<S extends Schemes = Schemes> extends Scope<never, [Root<S>]> {
  editor!: NodeEditor<S>;
  private readonly core: GraphCore;

  constructor() {
    super("dataflow-engine");
    if (!_loaded) throw new Error("the graph engine isn't loaded (loadGraphEngine)");
    this.core = new GraphCore(Cancelled);
    this.addPipe((context) => {
      switch (context.type) {
        case "nodecreated": this.core.addNode(context.data.id, context.data); break;
        case "noderemoved": this.core.removeNode(context.data.id); break;
        case "connectioncreated": this.mirrorConnection(context.data); break;
        case "connectionremoved": this.core.removeConnection(context.data.id); break;
      }
      return context;
    });
  }

  private mirrorConnection(c: S["Connection"]): void {
    this.core.addConnection(c.id, c.source, c.sourceOutput as string, c.target, c.targetInput as string);
  }

  setParent(scope: Scope<Root<S>>): void {
    super.setParent(scope);
    this.editor = this.parentScope<NodeEditor<S>>(NodeEditor);
    _engines.set(this.editor, this as unknown as DataflowEngine<Schemes>);
    for (const node of this.editor.getNodes()) this.core.addNode(node.id, node);
    for (const c of this.editor.getConnections()) this.mirrorConnection(c);
  }

  /** The node's outputs, computing whatever upstream isn't cached. */
  fetch(nodeId: string): Promise<NodeOutputs> {
    return this.core.fetch(nodeId);
  }

  /** The node's inputs, one list per input key, fetching every predecessor. */
  fetchInputs(nodeId: string): Promise<Record<string, unknown[]>> {
    return this.core.fetchInputs(nodeId);
  }

  /** Clears the node's cache and everything downstream through the outputs it computes; without a node, every cache.
   *  A fetch in flight rejects with `Cancelled`. */
  reset(nodeId?: string): void {
    this.core.reset(nodeId);
  }

  /** Gives the node `outputs` without running it, until a reset clears it. */
  seed(nodeId: string, outputs: NodeOutputs): void {
    this.core.seed(nodeId, outputs);
  }

  /** Clears the node's cache alone. */
  forget(nodeId: string): void {
    this.core.forget(nodeId);
  }

  isCached(nodeId: string): boolean {
    return this.core.isCached(nodeId);
  }

  /** Every node on a cable cycle. */
  loopMembers(): Set<string> {
    return new Set(this.core.loopMembers());
  }

  /** The node and everything its cables reach, through every cable. */
  downstreamClosure(nodeId: string): Set<string> {
    return new Set(this.core.downstreamClosure(nodeId));
  }

  /** Clears what a change to `nodeId` reaches and returns it; without a node, every cache unless `keepCaches`. */
  invalidate(nodeId: string | undefined, keepCaches: boolean): Set<string> | null {
    if (!nodeId) {
      if (!keepCaches) this.reset();
      return null;
    }
    return new Set(this.core.invalidate(nodeId, false));
  }

  /** Every node's outputs in the editor's order (`null` for one a reset cancelled), calling `onNode` as each lands;
   *  `null` for the whole pass when `stopOnCancel` and a reset cancelled it. */
  fetchAll(
    onNode?: (id: string, outputs: NodeOutputs) => void,
    stopOnCancel = false,
  ): Promise<Map<string, NodeOutputs | null> | null> {
    return this.core.fetchAll(onNode, stopOnCancel);
  }
}
