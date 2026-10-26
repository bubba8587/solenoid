// [[D102]] graphOnCore
// A node settled on the core (`settle.rs`) in a fresh editor: each fed input wired from a source whose output has the
// type given (and, for a frame, the static shape given), so a test reads what the node's outputs resolve to.
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput } from "../../src/graph/graphModel";
import { SolenoidSocket, type SocketDataType } from "../../src/graph/sockets";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";
import type { Shape } from "../../src/graph/frameShape";
import type { Schemes } from "../../src/graph/schemes";

export type Feed = SocketDataType | { type: SocketDataType; shape?: Shape | null };

/** The node's output types once settled with `feeds` wired in; the node leaves the editor after. */
export function settledOutputs(node: GraphNode, feeds: Record<string, Feed>): Record<string, SocketDataType> {
  const editor = new GraphEditor<Schemes>();
  void editor.addNode(node as never);
  for (const [key, feed] of Object.entries(feeds)) {
    const { type, shape } = typeof feed === "string" ? { type: feed, shape: undefined } : feed;
    const src = new GraphNode("Source");
    src.addOutput("out", new GraphOutput(new SolenoidSocket(type)));
    if (shape !== undefined) Object.assign(src, { frameShape: () => shape });
    void editor.addNode(src as never);
    void editor.addConnection(new GraphConnection(src, "out", node, key) as never);
  }
  settleWildcardTypes(editor);
  const out: Record<string, SocketDataType> = {};
  for (const k in node.outputs) out[k] = (node.outputs[k]!.socket as SolenoidSocket).dataType;
  void editor.clear();
  return out;
}
