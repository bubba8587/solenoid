// [[C10]] socketLattice, [[C130]] rustCore
// The walks through Conduits run on the core (`conduit.rs`): where an output's value comes from, and the run a cable
// belongs to.
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode, GraphSocket } from "./graphModel";

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;

type TypedSource = {
  socket: GraphSocket | undefined;
  source: string;
  sourceOutput: string;
};

/** Each editor's traced origins, valid while its wiring is unchanged: every cable on screen asks on each render. */
const traced = new WeakMap<AnyEditor, { topology: number; origins: Map<string, [string, string]> }>();

/** The output the value on `nodeId.outputKey` really comes from, through every Conduit lane, and its socket. The walk
 *  depends on the wiring alone, so it is kept until a card or cable comes or goes; the socket is read live. */
export function resolveTypedSource(editor: AnyEditor | null | undefined, nodeId: string, outputKey: string): TypedSource {
  if (!editor) return { socket: undefined, source: nodeId, sourceOutput: outputKey };
  let memo = traced.get(editor);
  if (!memo || memo.topology !== editor.topologyVersion) {
    memo = { topology: editor.topologyVersion, origins: new Map() };
    traced.set(editor, memo);
  }
  const key = `${nodeId}\u0001${outputKey}`;
  let origin = memo.origins.get(key);
  if (!origin) {
    origin = editor.core().typedSource(nodeId, outputKey) as [string, string];
    memo.origins.set(key, origin);
  }
  const [source, sourceOutput] = origin;
  return { socket: editor.getNode(source)?.outputs[sourceOutput]?.socket, source, sourceOutput };
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

interface ConduitPath {
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
