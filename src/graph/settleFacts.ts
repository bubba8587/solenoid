// [[C130]] rustCore, [[C10]] socketLattice
// What the Type Settle reads from each node's JavaScript object (graph-core.md § Phase D): each socket's current type
// and kind, the node's passthroughs as data, its Conduit lanes, and whether its output carries only errors. The
// core holds the node order and the cables.
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode } from "./graphModel";
import { AdoptiveSocket, MutableSocket, SolenoidSocket, type SocketDataType } from "./sockets";
import { getPassthrough, type CombineMode, type ProjectContext } from "./nodes/passthrough";
import { makeFrameShapeResolver } from "./frameShapeResolver";
import { ConduitNode, conduitInKey, conduitOutKey, CONDUIT_MAX_LANES } from "./nodes/conduit";

/** A socket: key, its type now, its declared base, and whether the settle may retype it: 0 fixed, 1 mutable, 2 adoptive. */
export type SocketFact = [key: string, now: SocketDataType, base: SocketDataType, kind: 0 | 1 | 2];

/** How a passthrough's output reads what it forwards: a frame or cube becomes the type named, any other table the
 *  `tables` rule ("trueany", or "combo": its family's combo), and anything else its combo. */
export interface ProjectFacts {
  frame: SocketDataType;
  cube: SocketDataType;
  tables: "trueany" | "combo";
}

export interface PassthroughFact {
  output: string;
  inputs: string[];
  combine: CombineMode;
  active?: number;
  project?: ProjectFacts;
}

export interface NodeFacts {
  id: string;
  ins: SocketFact[];
  outs: SocketFact[];
  pass?: PassthroughFact[];
  lanes?: [string, string][];
  errorOnly?: true;
}

function socketFact(key: string, socket: unknown): SocketFact | null {
  if (!(socket instanceof SolenoidSocket)) return null;
  if (socket instanceof AdoptiveSocket) return [key, socket.dataType, socket.base, 2];
  return [key, socket.dataType, socket.dataType, socket instanceof MutableSocket ? 1 : 0];
}

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;

export function settleFacts(editor: AnyEditor): NodeFacts[] {
  const shapes = makeFrameShapeResolver(editor as never);
  const conns = editor.getConnections();
  return editor.getNodes().map((node) => {
    const facts: NodeFacts = { id: node.id, ins: [], outs: [] };
    for (const k in node.inputs) {
      const f = socketFact(k, node.inputs[k]?.socket);
      if (f) facts.ins.push(f);
    }
    for (const k in node.outputs) {
      const f = socketFact(k, node.outputs[k]?.socket);
      if (f) facts.outs.push(f);
    }
    const ctx: ProjectContext = {
      shapeOf: (key) => {
        const feed = conns.find((c) => c.target === node.id && c.targetInput === key);
        return feed ? shapes.outShape(feed.source, feed.sourceOutput) : null;
      },
      wired: (key) => conns.some((c) => c.target === node.id && c.targetInput === key),
    };
    const pass = getPassthrough(node).map((s): PassthroughFact => ({
      output: s.output,
      inputs: s.inputs,
      combine: s.combine,
      ...(s.activeIndex ? { active: s.activeIndex() } : {}),
      ...(s.project ? { project: s.project(ctx) } : {}),
    }));
    if (pass.length) facts.pass = pass;
    if (node instanceof ConduitNode) {
      facts.lanes = Array.from({ length: CONDUIT_MAX_LANES }, (_, i): [string, string] => [conduitInKey(i), conduitOutKey(i)]);
    }
    if ((node as { errorOnlyOutput?: boolean }).errorOnlyOutput) facts.errorOnly = true;
    return facts;
  });
}
