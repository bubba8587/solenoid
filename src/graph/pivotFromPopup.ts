// [[B19]] spreadsheetHabits, [[table-popup#A Pivot's or Describe's popup opens on a view for reading, while its output stays a plain Frame]]
import { getOwningEditor } from "./activeGraph";
import { makeAnnotationResolver } from "./unitFlow";
import { isFrameValue, type FrameValue } from "./frame";
import { notifyGraphChanged, processGraph } from "./process";
import { PivotNode } from "./nodeClasses";
import { pivotEditor } from "./pivotEditorStore";
import { pivotConfigOf, writePivotConfig } from "./pivotConfig";
import { nodeDisplayName } from "./catalogUtils";
import { setPivotHostAction, type PivotHost } from "./tablePopupStore";

const outputOf = (node: PivotNode): FrameValue | null => (isFrameValue(node.cachedResult) ? node.cachedResult : null);

function findPivotHost(hostId: string): PivotHost | null {
  const editor = getOwningEditor(hostId);
  const node = editor?.getNode(makeAnnotationResolver(editor).valueOrigin(hostId));
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
    agg: node.agg,
    typeOf: (field) => node.sourceColumns.find((c) => c.name === field)?.type ?? "string",
    config: () => pivotConfigOf(node),
    async setConfig(next) {
      writePivotConfig(node, next);
      notifyGraphChanged();
      await processGraph(node.id);
      return outputOf(node);
    },
    async keysOf(field) {
      // A field lists all its values only while it filters: make it one for a pass, read them, and put it back, so a
      // look at the list leaves no empty filter behind.
      const added = !(field in node.filterExclude);
      if (added) {
        node.filterExclude = { ...node.filterExclude, [field]: [] };
        await processGraph(node.id);
      }
      const col = node.sourceColumns.find((c) => c.name === field);
      const out = { keys: col?.distinct ?? [], total: col?.distinctTotal ?? col?.distinct.length ?? 0 };
      if (added && (node.filterExclude[field]?.length ?? 0) === 0) {
        const { [field]: _gone, ...rest } = node.filterExclude;
        node.filterExclude = rest;
      }
      return out;
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
