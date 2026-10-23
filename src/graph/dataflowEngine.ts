// [[D102]] graphOnCore
// The dataflow engine, on the graph core (`crates/solenoid-graph`, Ruggine's port of rete-engine): a handle attached
// with `editor.use(engine)`, running on that editor's core, which calls each node's own `data()` back.
import { guarded, tracked, type GraphEditor } from "./graphEditor";
import type { GraphSchemes } from "./graphModel";
import type { Schemes } from "./schemes";

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

  /** Every node's outputs in the editor's order (`null` for one a reset cancelled), calling `onNode` as each lands;
   *  `null` for the whole pass when `stopOnCancel` and a reset cancelled it. */
  fetchAll(
    onNode?: (id: string, outputs: NodeOutputs) => void,
    stopOnCancel = false,
  ): Promise<Map<string, NodeOutputs | null> | null> {
    return tracked(() => this.core().fetchAll(onNode, stopOnCancel));
  }
}
