import type { ClassicPreset } from "rete";
import { ConduitNode, conduitLaneOf, conduitInKey } from "./rete-nodes";

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
