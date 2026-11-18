// [[B3]] sameNodeEverywhere
// React Flow's re-measure of a card's handle bounds, queued per instance and flushed together in the next frame, so a
// pass that moves many cards' sockets costs React Flow one store update and React one commit, not one each
// (`tree/specs/canvas/react-flow-surface-contract.md` § Socket anchors).
import type { useReactFlowStoreApi } from "@xyflow/react";

type FlowStore = ReturnType<typeof useReactFlowStoreApi>["optionsStore"];
type MeasureUpdates = Parameters<ReturnType<FlowStore["getState"]>["updateNodeInternals"]>[0];

const pendingMeasure = new WeakMap<FlowStore, Set<string>>();
/** The store each mounted card belongs to, so a socket that moves can ask for its card to be measured again. */
const storeOf = new Map<string, FlowStore>();

export function queueMeasure(store: FlowStore, id: string): void {
  let ids = pendingMeasure.get(store);
  if (ids) { ids.add(id); return; }
  ids = new Set([id]);
  pendingMeasure.set(store, ids);
  requestAnimationFrame(() => {
    pendingMeasure.delete(store);
    const { domNode, updateNodeInternals } = store.getState();
    const updates: MeasureUpdates = new Map();
    for (const nid of ids!) {
      const nodeElement = domNode?.querySelector<HTMLDivElement>(`.react-flow__node[data-id="${CSS.escape(nid)}"]`);
      if (nodeElement) updates.set(nid, { id: nid, nodeElement, force: true });
    }
    if (updates.size) updateNodeInternals(updates, { triggerFitView: false });
  });
}

export function registerCardStore(id: string, store: FlowStore): () => void {
  storeOf.set(id, store);
  return () => { if (storeOf.get(id) === store) storeOf.delete(id); };
}

/** A socket of card `id` moved within it: its cables re-anchor once the frame's moves are in. */
export function socketMoved(id: string): void {
  const store = storeOf.get(id);
  if (store) queueMeasure(store, id);
}
