import type { ClassicPreset, NodeEditor } from "rete";
import { ConduitNode, conduitLaneOf, conduitInKey, conduitOutKey, CONDUIT_MAX_LANES } from "./rete-nodes";
import { SolenoidSocket, MutableSocket, type SocketDataType } from "./sockets";
import type { Schemes } from "./schemes";

// ─── Conduit type tracing ──────────────────────────────────────────────────────
// A Conduit is a pure passthrough (out_i = in_i), but its lane sockets are all
// `any`, so a value leaving a Conduit resolves its cable colour by the JS VALUE
// type — lossy: a date is a serial number, a boolean/frame/cube an object, so
// they'd all colour as number/gray. Trace a Conduit output lane back to whatever
// feeds the matching input lane (recursively, for chained Conduits) so the cable
// takes the REAL source socket's type + value — the type colour carries through
// the Conduit unchanged (date stays pink, logical purple, frame violet, …).
// Kept in a pure module (no React) so it's unit-testable.

export type TypedSource = {
  socket: ClassicPreset.Socket | undefined;
  source: string;
  sourceOutput: string;
};

interface TraceEditor {
  getNode(id: string): { outputs?: Record<string, { socket?: ClassicPreset.Socket } | undefined> } | undefined;
  getConnections(): ReadonlyArray<{ source: string; sourceOutput: string; target: string; targetInput: string }>;
}

export function resolveTypedSource(
  editor: TraceEditor | null | undefined,
  nodeId: string,
  outputKey: string,
  depth = 0,
): TypedSource {
  const node = editor?.getNode(nodeId);
  // depth cap guards against a Conduit loop (a #CIRC! graph) trapping the walk.
  if (node instanceof ConduitNode && depth < 16) {
    const lane = conduitLaneOf(outputKey, "out");
    if (lane >= 0) {
      const inKey = conduitInKey(lane);
      const feed = editor?.getConnections().find((c) => c.target === nodeId && c.targetInput === inKey);
      if (feed) return resolveTypedSource(editor, feed.source, feed.sourceOutput, depth + 1);
    }
  }
  return { socket: node?.outputs?.[outputKey]?.socket, source: nodeId, sourceOutput: outputKey };
}

/**
 * Make every Conduit's OUTPUT lanes adopt the type feeding the matching input
 * lane (via resolveTypedSource, so it sees through upstream Conduits), so a lane
 * carries its real type downstream instead of an opaque `any`. Mutates the lane's
 * MutableSocket in place. Returns true if ANY lane's type changed — the caller
 * loops to a fixpoint (chained Conduits settle over a couple of passes) and then
 * re-validates downstream cables + Format Controllers. An unwired lane reverts to
 * `any`. Pure w.r.t. the store; the caller owns re-render + recompute.
 */
function reconcileConduitTypesOnce(editor: NodeEditor<Schemes>): boolean {
  let changed = false;
  const conns = editor.getConnections();
  for (const node of editor.getNodes()) {
    if (!(node instanceof ConduitNode)) continue;
    for (let i = 0; i < CONDUIT_MAX_LANES; i++) {
      const outSock = node.outputs[conduitOutKey(i)]?.socket;
      if (!(outSock instanceof MutableSocket)) continue;
      const feed = conns.find((c) => c.target === node.id && c.targetInput === conduitInKey(i));
      let newType: SocketDataType = "trueany";
      if (feed) {
        const resolved = resolveTypedSource(editor, feed.source, feed.sourceOutput);
        if (resolved.socket instanceof SolenoidSocket) newType = resolved.socket.dataType;
      }
      if (outSock.dataType !== newType) { outSock.setType(newType); changed = true; }
    }
  }
  return changed;
}

export function reconcileConduitTypes(editor: NodeEditor<Schemes>): boolean {
  // Fixpoint: a chain of Conduits settles in as many passes as the chain is deep
  // (each pass resolves through one more already-adapted Conduit). Capped well
  // above any real chain length (a #CIRC! conduit loop is also bounded by the cap).
  let anyChanged = false;
  for (let pass = 0; pass < 32; pass++) {
    if (!reconcileConduitTypesOnce(editor)) break;
    anyChanged = true;
  }
  return anyChanged;
}
