// [[D102]] graphOnCore, [[C25]] firstClassUnits
// What the Format Controller reconcile reads from each node's JavaScript object (`fc.rs`): every socket's type now, whether
// the node is a pure passthrough, a Convert's from-unit, and an FC's dock. The core holds the order and the cables.
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode } from "./graphModel";
import { SolenoidSocket } from "./sockets";
import { isPurePassthroughNode } from "./nodes/passthrough";
import { FormatControllerNode } from "./nodes/formatController";
import { ConvertNode } from "./nodes/convert";

export interface FcFacts {
  id: string;
  ins: Record<string, string>;
  outs: Record<string, string>;
  pure?: true;
  /** A Convert's from-unit. */
  convert?: string;
  /** An FC: docked on `host`'s `key` (an output unless `side` says input), or free. */
  fc?: { host?: string; key?: string; side?: "input" | "output" };
}

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;

export function fcFacts(editor: AnyEditor): FcFacts[] {
  return editor.getNodes().map((n) => {
    const f: FcFacts = { id: n.id, ins: {}, outs: {} };
    for (const k in n.inputs) { const s = n.inputs[k]?.socket; if (s instanceof SolenoidSocket) f.ins[k] = s.dataType; }
    for (const k in n.outputs) { const s = n.outputs[k]?.socket; if (s instanceof SolenoidSocket) f.outs[k] = s.dataType; }
    if (isPurePassthroughNode(n)) f.pure = true;
    if (n instanceof ConvertNode) f.convert = n.fromUnit;
    if (n instanceof FormatControllerNode) f.fc = n.hostNodeId ? { host: n.hostNodeId, key: n.socketKey, side: n.side } : {};
    return f;
  });
}
