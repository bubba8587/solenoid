// [[C130]] rustCore, [[C10]] socketLattice
// What the Type Settle reads from each node's JavaScript object (graph-core.md § Phase D): socket types and kinds,
// passthroughs, Conduit lanes, and whether its output carries only errors; the core holds the order and the cables.
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode } from "./graphModel";
import { AdoptiveSocket, MutableSocket, SolenoidSocket, ValueTypedSocket, type SocketDataType } from "./sockets";
import { getPassthrough, type CombineMode, type ProjectContext } from "./nodes/passthrough";
import { makeFrameShapeResolver } from "./frameShapeResolver";
import { keyedRestType, type LiteralFieldHost } from "./literalFields";
import { ConduitNode, conduitInKey, conduitOutKey, CONDUIT_MAX_LANES } from "./nodes/conduit";

/** A socket: key, its type now, its declared base, and whether the settle may retype it: 0 fixed, 1 mutable, 2 adoptive,
 *  3 typed by its value; an adoptive input may add the type it shows unwired (a keyed slot's kind, `keyedRestType`). */
type SocketFact = [key: string, now: SocketDataType, base: SocketDataType, kind: 0 | 1 | 2 | 3, rest?: SocketDataType];

/** The outputs of these freshly computed cards whose type the value they carried may give, as the core's `readTypes`
 *  takes them: every passthrough output and every value-typed output, with its type now ([[D117]] emptyKeepsLastType). */
export function readTypeKeys(nodes: readonly (GraphNode | undefined)[]): [string, string, SocketDataType][] {
  const keys: [string, string, SocketDataType][] = [];
  for (const n of nodes) {
    if (!n) continue;
    const passed = new Set(getPassthrough(n).map((s) => s.output));
    for (const k in n.outputs) {
      const socket = n.outputs[k]?.socket;
      if (!(socket instanceof MutableSocket)) continue;
      if (passed.has(k) || socket instanceof ValueTypedSocket) keys.push([n.id, k, socket.dataType]);
    }
  }
  return keys;
}

/** How a passthrough's output reads what it forwards: a frame or cube becomes the type named, any other table the
 *  `tables` rule ("trueany", or "combo": its family's combo), and anything else its combo. */
export interface ProjectFacts {
  frame: SocketDataType;
  cube: SocketDataType;
  tables: "trueany" | "combo";
}

interface PassthroughFact {
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
  if (socket instanceof AdoptiveSocket) return [key, socket.dataType, socket.base, socket instanceof ValueTypedSocket ? 3 : 2];
  return [key, socket.dataType, socket.dataType, socket instanceof MutableSocket ? 1 : 0];
}

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;

export function settleFacts(editor: AnyEditor): NodeFacts[] {
  const shapes = makeFrameShapeResolver(editor as never);
  return editor.getNodes().map((node) => {
    const facts: NodeFacts = { id: node.id, ins: [], outs: [] };
    for (const k in node.inputs) {
      const f = socketFact(k, node.inputs[k]?.socket);
      if (!f) continue;
      const rest = f[3] === 2 ? keyedRestType(node as unknown as LiteralFieldHost, k) : undefined;
      facts.ins.push(rest ? [f[0], f[1], f[2], f[3], rest] : f);
    }
    for (const k in node.outputs) {
      const f = socketFact(k, node.outputs[k]?.socket);
      if (f) facts.outs.push(f);
    }
    const ctx: ProjectContext = {
      shapeOf: (key) => {
        const feed = editor.connectionsInto(node.id).find((c) => c.targetInput === key);
        return feed ? shapes.outShape(feed.source, feed.sourceOutput) : null;
      },
      wired: (key) => editor.connectionsInto(node.id).some((c) => c.targetInput === key),
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
