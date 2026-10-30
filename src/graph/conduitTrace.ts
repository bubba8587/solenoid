// [[C10]] socketLattice, [[C130]] rustCore
// The walks through Conduits run on the core (`conduit.rs`): where an output's value comes from, and the run a cable
// belongs to.
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode, GraphSocket } from "./graphModel";

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;

export type TypedSource = {
  socket: GraphSocket | undefined;
  source: string;
  sourceOutput: string;
};

/** The output the value on `nodeId.outputKey` really comes from, through every Conduit lane, and its socket. */
export function resolveTypedSource(editor: AnyEditor | null | undefined, nodeId: string, outputKey: string): TypedSource {
  const [source, sourceOutput] = editor ? editor.core().typedSource(nodeId, outputKey) : [nodeId, outputKey];
  return { socket: editor?.getNode(source)?.outputs[sourceOutput]?.socket, source, sourceOutput };
}

export interface PathConn {
  id: string;
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

export interface ConduitPathEnd {
  nodeId: string;
  key: string;
}

export interface ConduitPath {
  connIds: string[];
  origin: ConduitPathEnd;
  terminals: ConduitPathEnd[];
  conduits: string[];
}

/** The run `conn` belongs to: its producer, every cable and Conduit it crosses, and each consumer. */
export function conduitPath(editor: AnyEditor | null | undefined, conn: PathConn): ConduitPath {
  const text = editor?.core().conduitPath(conn.id);
  if (!text) return { connIds: [conn.id], origin: { nodeId: conn.source, key: conn.sourceOutput }, terminals: [{ nodeId: conn.target, key: conn.targetInput }], conduits: [] };
  const p = JSON.parse(text) as { connIds: string[]; origin: [string, string]; terminals: [string, string][]; conduits: string[] };
  return {
    connIds: p.connIds,
    origin: { nodeId: p.origin[0], key: p.origin[1] },
    terminals: p.terminals.map(([nodeId, key]) => ({ nodeId, key })),
    conduits: p.conduits,
  };
}
