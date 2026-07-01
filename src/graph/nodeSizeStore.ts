// Per-node manual size set by dragging a node's resize handle. Module-level
// store (like collapseStore / dockedNodeStore) so it's readable from Rete's
// separate React root. Persisted with the graph (see persistence.ts).
//
// Only "resizable" nodes (inputs, text/string, Display, lookups — see
// nodeResizable) expose a handle; everything else auto-sizes and truncates.

import { createNotifier } from "./storeKit";
import { registerNodeForget } from "./nodeStoreRegistry";

export type NodeSize = { w: number; h: number };

const _sizes = new Map<string, NodeSize>();
const { notify, subscribe } = createNotifier();
// True while a ResizeHandle drag is in flight. NodeCard's ResizeObserver checks
// it and skips its area.update() during the drag — that update re-renders the
// node, which would recreate the grip element and drop its pointer capture (the
// drag would stop after one move). The final sync runs on drag end.
let _dragging = false;

export const nodeSizeStore = {
  get: (id: string): NodeSize | undefined => _sizes.get(id),
  set(id: string, size: NodeSize | undefined): void {
    if (!size) _sizes.delete(id);
    else _sizes.set(id, size);
    notify();
  },
  setDragging(v: boolean): void { _dragging = v; },
  isDragging: (): boolean => _dragging,
  entries: (): Array<[string, NodeSize]> => [..._sizes.entries()],
  /** Forget a deleted node (noderemoved → forgetNode). */
  forget(id: string): void {
    if (_sizes.delete(id)) notify();
  },
  clear(): void {
    if (_sizes.size === 0) return;
    _sizes.clear();
    notify();
  },
  subscribe,
};

registerNodeForget(nodeSizeStore.forget);
