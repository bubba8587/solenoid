// [[B11]] maximalMerge
import { getOwningEditor } from "../activeGraph";
import { processGraph } from "../process";
import { RecordNode, CardsNode } from "../nodeClasses";
import type { ChartValue } from "../chartValue";
import { clamp } from "../nodes/mathUtils";

const MAX_WALK = 8;

const isRecordLike = (n: unknown): n is RecordNode | CardsNode => n instanceof RecordNode || n instanceof CardsNode;

function recordSourceOf(nodeId: string): RecordNode | CardsNode | null {
  const editor = getOwningEditor(nodeId);
  if (!editor) return null;
  let cur = editor.getNode(nodeId);
  for (let hops = 0; cur && hops < MAX_WALK; hops++) {
    if (isRecordLike(cur)) return cur;
    const incoming = editor.getConnections().filter((c) => c.target === cur!.id);
    if (incoming.length !== 1) return null;
    cur = editor.getNode(incoming[0].source);
  }
  return isRecordLike(cur) ? cur : null;
}

export function recordNavTarget(nodeId: string): string | null {
  const rec = recordSourceOf(nodeId);
  if (!(rec instanceof RecordNode) || rec.op !== "detail") return null;
  const total = rec.cachedChart?.payload?.kind === "record" ? rec.cachedChart.payload.total : 0;
  return total > 1 ? rec.id : null;
}

/** The Record or Cards card a figure shows, in any view: the popup's filter reaches it. */
export function recordFilterTarget(nodeId: string): string | null {
  return recordSourceOf(nodeId)?.id ?? null;
}

/** The records drawn are those holding every word of `query` (Detail from the first match); blank draws them all. */
export async function setRecordQuery(recordId: string, query: string): Promise<ChartValue | null> {
  const rec = getOwningEditor(recordId)?.getNode(recordId);
  if (!isRecordLike(rec)) return null;
  if ((rec.stringLiterals.query ?? "") === query) return rec.cachedChart;
  if (query) rec.stringLiterals.query = query;
  else delete rec.stringLiterals.query;
  if (rec instanceof RecordNode) rec.literals.page = 1;
  await processGraph(recordId);
  return rec.cachedChart;
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
