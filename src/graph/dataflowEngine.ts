// [[C130]] rustCore
// The dataflow engine, on the graph core (`crates/solenoid-graph`, Ruggine's port of rete-engine): a handle attached
// with `editor.use(engine)`, running on that editor's core, which calls each node's own `data()` back.
import type { GraphEditor } from "./graphEditor";
import { guarded, onCore, tracked } from "./engineWasm";
import type { GraphSchemes } from "./graphModel";
import type { Schemes } from "./schemes";
import "./nodeBoundary";

/** The engine an editor uses: the graph walks live there, beside the graph they walk. */
export function engineOf<S extends GraphSchemes>(editor: GraphEditor<S>): DataflowEngine<S> {
  if (!editor.engine) throw new Error("this editor has no DataflowEngine");
  return editor.engine;
}

export type NodeOutputs = Record<string, unknown>;

/** A node the engine computes: its `data()` gets one list per wired input key. */
export type DataflowNode = {
  data(inputs: Record<string, unknown[]>): Promise<NodeOutputs> | NodeOutputs;
};

export class DataflowEngine<S extends GraphSchemes = Schemes> {
  editor?: GraphEditor<S>;
  /** Calls each node's `data()` as it is, where every other engine runs it through the input boundary
   *  (compute-pass.md § The per-node wrappers): the bare rete-engine shape, for the engine's own tests. */
  readonly raw: boolean;

  constructor(opts?: { raw?: boolean }) {
    this.raw = opts?.raw === true;
  }

  /** `editor.use(engine)` calls this. */
  attach(editor: GraphEditor<S>): void {
    this.editor = editor;
  }

  private core() {
    if (!this.editor) throw new Error("DataflowEngine isn't attached to NodeEditor");
    return this.editor.core();
  }

  /** The node's outputs, computing whatever upstream isn't cached. */
  fetch(nodeId: string): Promise<NodeOutputs> {
    return tracked(() => this.core().fetch(nodeId));
  }

  /** The node computed on `inputs` as a fetch computes it, boundary included, without reading or filling its cache:
   *  a composite's simulation steps, and a test driving one node. */
  compute(nodeId: string, inputs: Record<string, unknown[]>): Promise<NodeOutputs> {
    return tracked(() => this.core().compute(nodeId, inputs));
  }

  /** The node's inputs, one list per input key, fetching every predecessor. */
  fetchInputs(nodeId: string): Promise<Record<string, unknown[]>> {
    return tracked(() => this.core().fetchInputs(nodeId));
  }

  /** Clears the node's cache and everything downstream through the outputs it computes; without a node, every cache.
   *  A fetch in flight rejects with `Cancelled`. */
  reset(nodeId?: string): void {
    guarded(() => this.core().reset(nodeId));
  }

  /** Gives the node `outputs` without running it, until a reset clears it. */
  seed(nodeId: string, outputs: NodeOutputs): void {
    guarded(() => this.core().seed(nodeId, outputs));
  }

  /** Clears the node's cache alone. */
  forget(nodeId: string): void {
    guarded(() => this.core().forget(nodeId));
  }

  isCached(nodeId: string): boolean {
    return guarded(() => this.core().isCached(nodeId));
  }

  /** Every node on a cable cycle. */
  loopMembers(): Set<string> {
    return new Set(guarded(() => this.core().loopMembers()));
  }

  /** The node and everything its cables reach, through every cable. */
  downstreamClosure(nodeId: string): Set<string> {
    return new Set(guarded(() => this.core().downstreamClosure(nodeId)));
  }

  /** Clears what a change to `nodeId` reaches and returns it; without a node, every cache unless `keepCaches`. */
  invalidate(nodeId: string | undefined, keepCaches: boolean): Set<string> | null {
    if (!nodeId) {
      if (!keepCaches) this.reset();
      return null;
    }
    return new Set(guarded(() => this.core().invalidate(nodeId, false)) ?? []);
  }

  /** Seeds `#CIRC!` (with `message`, or the default) on every node on a cable cycle, so no fetch recurses into one; the
   *  members. */
  seedLoops(message?: string): Set<string> {
    return new Set(guarded(() => this.core().seedLoops(message)));
  }

  /** Marks every composite holding `nodeId` as edited inside; the outermost one's id. */
  markNested(nodeId: string): string | undefined {
    return guarded(() => this.core().markNested(nodeId));
  }

  /** The model pass: `nodeId`'s reach cleared (every cache without it), the loops seeded, every node fetched. */
  computeAll(nodeId?: string): Promise<Map<string, NodeOutputs | null> | null> {
    return tracked(() => this.core().computeAll(nodeId));
  }

  /** The app's pass body (compute-pass.md § The pass body): `changed` retargeted into the composite holding it, its
   *  reach cleared (everything when none; nothing for an additive pass, `renderOnly`), the loops seeded (a value
   *  edit reuses the last set unless `topology`), every node fetched and landed (`landed`). The nodes to re-render,
   *  or `null` when a reset cancelled the pass. */
  pass(
    changed: string | undefined,
    renderOnly: ReadonlySet<string> | undefined,
    topology: boolean,
  ): Promise<string[] | null> {
    return tracked(() => this.core().pass(changed, renderOnly ? [...renderOnly] : undefined, topology));
  }

  /** A node's output as the last pass landed it, converted when asked; `undefined` before a pass landed it. */
  landed(nodeId: string, key: string): unknown {
    return onCore(() => guarded(() => this.core().landed(nodeId, key)), undefined);
  }

  /** Every node's outputs in the editor's order (`null` for one a reset cancelled), calling `onNode` as each lands;
   *  `null` for the whole pass when `stopOnCancel` and a reset cancelled it. */
  fetchAll(
    onNode?: (id: string, outputs: NodeOutputs) => void,
    stopOnCancel = false,
  ): Promise<Map<string, NodeOutputs | null> | null> {
    return tracked(() => this.core().fetchAll(onNode, stopOnCancel));
  }
}
