// [[C43]] oneFlowSurface, [[C10]] socketLattice
// Asymmetric and depth-limited: hovering an origin lights all its cables and their destinations, hovering a
// destination lights that cable and the origin; a Conduit lane is followed through once.

import { dragSocketKey } from "./cableState";
import { getOwningEditor } from "./activeGraph";

type Side = "input" | "output";

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
  const editor = getOwningEditor(startNodeId);
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
