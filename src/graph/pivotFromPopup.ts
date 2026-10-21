// [[C127]] pivotView
import { getOwningEditor } from "./activeGraph";
import { resolveValueOrigin } from "./unitFlow";
import { isFrameValue, type FrameValue } from "./frame";
import { notifyGraphChanged, processGraph } from "./process";
import { PivotNode } from "./rete-nodes";
import { pivotEditor } from "./pivotEditorStore";
import { nodeDisplayName } from "./catalogUtils";
import { setPivotHostAction, type PivotHost } from "./tablePopupStore";

const outputOf = (node: PivotNode): FrameValue | null => (isFrameValue(node.cachedResult) ? node.cachedResult : null);

function findPivotHost(hostId: string): PivotHost | null {
  const editor = getOwningEditor(hostId);
  const node = editor?.getNode(resolveValueOrigin(editor, hostId));
  if (!(node instanceof PivotNode)) return null;
  return {
    view: node.pivotView,
    setView(view) { node.pivotView = view; notifyGraphChanged(); },
    totals: { rowTotalDepth: node.rowTotalDepth, colTotalDepth: node.colTotalDepth },
    async setTotals(t) {
      node.rowTotalDepth = t.rowTotalDepth;
      node.colTotalDepth = t.colTotalDepth;
      notifyGraphChanged();
      await processGraph(node.id);
      return outputOf(node);
    },
    editFields(onClosed, accent) {
      pivotEditor.open({ node, nodeId: node.id, title: nodeDisplayName(node), accent, onClosed: () => void processGraph(node.id).then(() => onClosed(outputOf(node))) });
    },
  };
}

export function installPivotHostAction(): () => void {
  setPivotHostAction({ find: findPivotHost });
  return () => setPivotHostAction(null);
}
