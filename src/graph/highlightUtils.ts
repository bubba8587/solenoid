// Resolve which sockets and cables should highlight when hovering a socket.
//
// Rules:
//  1. The hovered socket itself.
//  2. Every cable directly attached to it.
//  3. The socket at the far end of each of those cables.
//  4. If that far-end socket is a Conduit lane (in_i ↔ out_i pass-through),
//     follow through to the paired socket, then include the cables and
//     endpoints attached to the paired socket — but stop there.
//
// This means: hover origin → see all its cables + destinations.
//             hover destination → see that cable + the origin only.
//             A Conduit is transparent (treated as a single logical wire).

import { getEditor } from "./process";
import { dragSocketKey } from "./cableState";

type Side = "input" | "output";

// Pair an `in_N` lane socket with its `out_N` sibling (and vice-versa) on a
// multi-lane bundler — the Conduit. (Same scheme the removed Manifold used.)
function pairedLaneKey(
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
  socketKey: string,
): { key: string; side: Side } | null {
  const inMatch = socketKey.match(/^in_(\d+)$/);
  if (inMatch) {
    const k = `out_${inMatch[1]}`;
    return k in outputs ? { key: k, side: "output" } : null;
  }
  const outMatch = socketKey.match(/^out_(\d+)$/);
  if (outMatch) {
    const k = `in_${outMatch[1]}`;
    return k in inputs ? { key: k, side: "input" } : null;
  }
  return null;
}

export function resolveSocketHighlights(
  startNodeId: string,
  startSocketKey: string,
): { socketKeys: string[]; cableIds: string[] } {
  const editor = getEditor();
  if (!editor) return { socketKeys: [], cableIds: [] };

  const startNode = editor.getNode(startNodeId);
  if (!startNode) return { socketKeys: [], cableIds: [] };

  const socketKeys = new Set<string>();
  const cableIds   = new Set<string>();

  socketKeys.add(dragSocketKey(startNodeId, startSocketKey));

  const startSide: Side = startSocketKey in startNode.inputs ? "input" : "output";

  // Step 1: cables directly on the hovered socket.
  const direct = editor.getConnections().filter(c =>
    startSide === "output"
      ? c.source === startNodeId && c.sourceOutput === startSocketKey
      : c.target === startNodeId && c.targetInput  === startSocketKey,
  );

  for (const conn of direct) {
    cableIds.add(conn.id);

    const farNodeId    = startSide === "output" ? conn.target      : conn.source;
    const farSocketKey = startSide === "output" ? conn.targetInput : conn.sourceOutput;
    socketKeys.add(dragSocketKey(farNodeId, farSocketKey));

    // Step 2: if the far end is a Conduit lane, follow through once.
    const farNode = editor.getNode(farNodeId);
    if (!farNode) continue;
    const paired = pairedLaneKey(farNode.inputs, farNode.outputs, farSocketKey);
    if (!paired) continue;

    socketKeys.add(dragSocketKey(farNodeId, paired.key));

    const beyondConns = editor.getConnections().filter(c =>
      paired.side === "output"
        ? c.source === farNodeId && c.sourceOutput === paired.key
        : c.target === farNodeId && c.targetInput  === paired.key,
    );

    for (const bc of beyondConns) {
      cableIds.add(bc.id);
      const endNodeId    = paired.side === "output" ? bc.target      : bc.source;
      const endSocketKey = paired.side === "output" ? bc.targetInput : bc.sourceOutput;
      socketKeys.add(dragSocketKey(endNodeId, endSocketKey));
    }
  }

  return { socketKeys: [...socketKeys], cableIds: [...cableIds] };
}
