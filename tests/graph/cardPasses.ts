// [[C23]] calcModes, [[D79]] effectsEdgeTriggered
// One card in a real editor, computed by full passes, as the engine calls it directly (graph-core.md § Direct
// calls): what it holds between passes (a draw for the recalc generation, an alert's last status) is seen only so.
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import { nextGeneration } from "../../src/graph/passSession";
import type { Schemes } from "../../src/graph/schemes";

/** A source whose `out` a test sets between passes. */
export class Src extends GraphNode {
  constructor(public out: unknown, socket = "list") { super("src"); this.addOutput("out", new GraphOutput(new GraphSocket(socket))); }
  data() { return { out: this.out }; }
}

export async function inEditor(node: GraphNode) {
  const editor = new GraphEditor<Schemes>();
  editor.use(new DataflowEngine<Schemes>());
  await editor.addNode(node as never);
  return {
    /** Cables `src`'s `out` into the card's `input`. */
    async wire(src: GraphNode, input: string) {
      await editor.addNode(src as never);
      await editor.addConnection(new GraphConnection(src, "out", node, input) as never);
    },
    /** A full pass, then what `key` landed. */
    async pass(key: string): Promise<unknown> {
      await editor.engine!.pass(undefined, undefined, false);
      return editor.engine!.landed(node.id, key);
    },
    /** F9: a new recalc generation. */
    recalc: () => { nextGeneration(); },
    dispose: () => editor.dispose(),
  };
}
