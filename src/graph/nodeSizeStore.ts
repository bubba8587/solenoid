// [[B10]] reactFlowView (module-singleton store, storeKit)

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

export type NodeSize = { w: number; h: number };

const _sizes = new Map<string, NodeSize>();
// Per-node minimum from the node's current content type; the grip clamps to it so a Display can't shrink its content into uselessness.
const _mins = new Map<string, NodeSize>();
const { notify, subscribe } = createNotifier();

export const nodeSizeStore = {
  get: (id: string): NodeSize | undefined => _sizes.get(id),
  set(id: string, size: NodeSize | undefined): void {
    if (!size) _sizes.delete(id);
    else _sizes.set(id, size);
    notify();
  },
  /** No notify: the grip reads it on drag. */
  setMin(id: string, size: NodeSize | undefined): void {
    if (!size) _mins.delete(id);
    else _mins.set(id, size);
  },
  getMin: (id: string): NodeSize | undefined => _mins.get(id),
  entries: (): Array<[string, NodeSize]> => [..._sizes.entries()],
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
