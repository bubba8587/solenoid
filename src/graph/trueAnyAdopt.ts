// [[C10]] socketLattice, [[C130]] rustCore
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode } from "./graphModel";
import { MutableSocket, type SocketDataType } from "./sockets";
import { settleFacts } from "./settleFacts";

/** The Type Settle (`settle.rs`): Conduit lanes and adoption to a joint fixpoint, run by the core over this editor's
 *  graph; each socket it retypes takes the new type here. */
export function settleWildcardTypes(editor: GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>): { conduitChanged: boolean; adopted: Set<string>; followed: [string, string][]; retyped: Set<string> } {
  const answer = JSON.parse(editor.core().settleTypes(JSON.stringify(settleFacts(editor)))) as {
    changes: [string, "in" | "out", string, SocketDataType][];
    conduitChanged: boolean;
    adopted: string[];
  };
  // Every card a socket of which moved: its next compute may answer differently, so a pass must reach it.
  const retyped = new Set<string>();
  for (const [id, side, key, type] of answer.changes) {
    retyped.add(id);
    const node = editor.getNode(id);
    const socket = (side === "in" ? node?.inputs[key] : node?.outputs[key])?.socket;
    if (socket instanceof MutableSocket) socket.setType(type);
    // An input's adopted type is part of the card's call (`adopted`, `nodeOnCore.ts`): naming the card makes a direct
    // card read it afresh, or its body keeps the type it was first called with.
    if (side === "in" && node) editor.named(id);
  }
  const adopted = new Set(answer.adopted);
  // An input that takes the kind of another input's settled type (Expect's bounds) follows it now.
  const followed: [string, string][] = [];
  for (const node of editor.getNodes()) {
    const moved = (node as { settleFollowers?: () => string[] }).settleFollowers?.() ?? [];
    if (moved.length === 0) continue;
    adopted.add(node.id);
    retyped.add(node.id);
    editor.named(node.id);
    for (const key of moved) followed.push([node.id, key]);
  }
  for (const id of adopted) retyped.add(id);
  return { conduitChanged: answer.conduitChanged, adopted, followed, retyped };
}
