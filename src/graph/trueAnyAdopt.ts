// [[C10]] socketLattice, [[D102]] graphOnCore
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode } from "./graphModel";
import { MutableSocket, type SocketDataType } from "./sockets";
import { settleFacts } from "./settleFacts";

/** The Type Settle (`settle.rs`): Conduit lanes and adoption to a joint fixpoint, run by the core over this editor's
 *  graph; each socket it retypes takes the new type here. */
export function settleWildcardTypes(editor: GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>): { conduitChanged: boolean; adopted: Set<string> } {
  const answer = JSON.parse(editor.core().settleTypes(JSON.stringify(settleFacts(editor)))) as {
    changes: [string, "in" | "out", string, SocketDataType][];
    conduitChanged: boolean;
    adopted: string[];
  };
  for (const [id, side, key, type] of answer.changes) {
    const node = editor.getNode(id);
    const socket = (side === "in" ? node?.inputs[key] : node?.outputs[key])?.socket;
    if (socket instanceof MutableSocket) socket.setType(type);
  }
  return { conduitChanged: answer.conduitChanged, adopted: new Set(answer.adopted) };
}
