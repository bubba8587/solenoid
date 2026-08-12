// The traversal is deliberately asymmetric and depth-limited:
//   hover origin      → all its cables + their destinations.
//   hover destination → that cable + the origin only.
//   a Conduit lane is transparent (one logical wire), followed through ONCE.

import { getEditor } from "./process";
import { dragSocketKey } from "./cableState";

type Side = "input" | "output";

// Pair an `in_N` lane socket with its `out_N` sibling on a Conduit.
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

    // If the far end is a Conduit lane, follow through ONCE — never further.
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
