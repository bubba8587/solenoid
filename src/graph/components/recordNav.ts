// Record-card navigation from the surfaces that DRAW the card (Display, chart
// popup) — the card itself moved off the node card, so the pager rides along.
// Stepping drives the node's unwired Row literal, exactly like the on-node
// pager; a wired Row means the cable wins and no surface offers arrows.
import { getOwningEditor } from "../activeGraph";
import { processGraph } from "../process";
import { RecordNode } from "../rete-nodes";
import type { ChartValue } from "../chartValue";
import { clamp } from "../nodes/mathUtils";

const MAX_WALK = 8;

/** The RecordNode whose card `nodeId`'s surface shows: the node itself, or a
 *  short walk up a single-inlet chain (a Display or passthrough run between). */
function recordSourceOf(nodeId: string): RecordNode | null {
  const editor = getOwningEditor(nodeId);
  if (!editor) return null;
  let cur = editor.getNode(nodeId);
  for (let hops = 0; cur && hops < MAX_WALK; hops++) {
    if (cur instanceof RecordNode) return cur;
    const incoming = editor.getConnections().filter((c) => c.target === cur!.id);
    if (incoming.length !== 1) return null;
    cur = editor.getNode(incoming[0].source);
  }
  return cur instanceof RecordNode ? cur : null;
}

/** Id of the steppable Record card behind `nodeId`, or null (no record source,
 *  not the card view, a wired Row, or nothing to flip through). */
export function recordNavTarget(nodeId: string): string | null {
  const rec = recordSourceOf(nodeId);
  if (!rec || rec.view !== "card") return null;
  const editor = getOwningEditor(rec.id);
  if (!editor) return null;
  const rowWired = editor.getConnections().some((c) => c.target === rec.id && c.targetInput === "row");
  if (rowWired) return null;
  const total = rec.cachedChart?.payload?.kind === "record" ? rec.cachedChart.payload.total : 0;
  return total > 1 ? rec.id : null;
}

/** Step the record's Row literal and recompute; resolves to the fresh chart
 *  value (for surfaces holding a snapshot, like the popup) or null. */
export async function stepRecordRow(recordId: string, delta: number): Promise<ChartValue | null> {
  const editor = getOwningEditor(recordId);
  const rec = editor?.getNode(recordId);
  if (!(rec instanceof RecordNode)) return null;
  const total = rec.cachedChart?.payload?.kind === "record" ? rec.cachedChart.payload.total : 0;
  if (total < 1) return null;
  const next = clamp((rec.literals.row ?? 1) + delta, 1, total);
  if (next === rec.literals.row) return rec.cachedChart;
  rec.literals.row = next;
  await processGraph(recordId);
  return rec.cachedChart;
}
