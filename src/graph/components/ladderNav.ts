// [[C100]] chartIsAValue
import { getOwningEditor } from "../activeGraph";
import { processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { ChoiceLadderNode } from "../nodeClasses";
import type { ChartValue } from "../chartValue";
import { nextChoices, type LadderAction } from "../nodes/ladderOps";

const MAX_WALK = 8;

/** The Choice Ladder a surface draws: the node itself, or the one up to 8 single-inlet hops upstream (a Display's source). */
export function ladderTarget(nodeId: string): string | null {
  const editor = getOwningEditor(nodeId);
  if (!editor) return null;
  let cur = editor.getNode(nodeId);
  for (let hops = 0; cur && hops <= MAX_WALK; hops++) {
    if (cur instanceof ChoiceLadderNode) return cur.id;
    const incoming = editor.getConnections().filter((c) => c.target === cur!.id);
    if (incoming.length !== 1) return null;
    cur = editor.getNode(incoming[0].source);
  }
  return null;
}

/** Applies an action to the node's saved choices, recomputes, and hands back the fresh figure. */
export async function applyLadderAction(ladderId: string, a: LadderAction): Promise<ChartValue | null> {
  const node = getOwningEditor(ladderId)?.getNode(ladderId);
  if (!(node instanceof ChoiceLadderNode)) return null;
  node.choices = nextChoices(node.choices, a);
  await processGraph(ladderId);
  scheduleAutosave();
  const v = node.cachedChart;
  return v && "__chart" in v ? v : null;
}
