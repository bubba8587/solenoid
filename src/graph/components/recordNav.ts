// [[B11]] maximalMerge
import { getOwningEditor } from "../activeGraph";
import { processGraph } from "../process";
import { RecordNode } from "../rete-nodes";
import type { ChartValue } from "../chartValue";
import { clamp } from "../nodes/mathUtils";

const MAX_WALK = 8;

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

export function recordNavTarget(nodeId: string): string | null {
  const rec = recordSourceOf(nodeId);
  if (!rec || rec.op !== "detail") return null;
  const total = rec.cachedChart?.payload?.kind === "record" ? rec.cachedChart.payload.total : 0;
  return total > 1 ? rec.id : null;
}

export async function stepRecordRow(recordId: string, delta: number): Promise<ChartValue | null> {
  const editor = getOwningEditor(recordId);
  const rec = editor?.getNode(recordId);
  if (!(rec instanceof RecordNode)) return null;
  const total = rec.cachedChart?.payload?.kind === "record" ? rec.cachedChart.payload.total : 0;
  if (total < 1) return null;
  const next = clamp((rec.literals.page ?? 1) + delta, 1, total);
  if (next === rec.literals.page) return rec.cachedChart;
  rec.literals.page = next;
  await processGraph(recordId);
  return rec.cachedChart;
}
