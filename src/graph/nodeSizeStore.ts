// Per-node manual size set by dragging a node's resize handle. Module-level store so
// it's readable from Rete's separate React root; persisted with the graph. Only
// `nodeResizable` nodes expose a handle; everything else auto-sizes and truncates.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

export type NodeSize = { w: number; h: number };

const _sizes = new Map<string, NodeSize>();
// Per-node minimum size (card width, box height), published by the node from its
// CURRENT content type — a chart needs more room than a scalar. The resize grip
// clamps to it so a Display can't shrink its content into uselessness.
const _mins = new Map<string, NodeSize>();
const { notify, subscribe } = createNotifier();

export const nodeSizeStore = {
  get: (id: string): NodeSize | undefined => _sizes.get(id),
  set(id: string, size: NodeSize | undefined): void {
    if (!size) _sizes.delete(id);
    else _sizes.set(id, size);
    notify();
  },
  /** Publish a node's content-driven minimum size (no notify — read on drag). */
  setMin(id: string, size: NodeSize | undefined): void {
    if (!size) _mins.delete(id);
    else _mins.set(id, size);
  },
  getMin: (id: string): NodeSize | undefined => _mins.get(id),
  entries: (): Array<[string, NodeSize]> => [..._sizes.entries()],
  /** Forget a deleted node (noderemoved → forgetNode). */
  forget(id: string): void {
    _mins.delete(id);
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
registerNodeForgetAll(() => nodeSizeStore.clear());
