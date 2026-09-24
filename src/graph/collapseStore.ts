// [[B10]] reactFlowView

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const _collapsed = new Set<string>();
const { notify, subscribe } = createNotifier();

export const collapseStore = {
  get: (nodeId: string) => _collapsed.has(nodeId),
  forget(nodeId: string) {
    if (_collapsed.delete(nodeId)) notify();
  },
  toggle(nodeId: string) {
    if (_collapsed.has(nodeId)) _collapsed.delete(nodeId);
    else _collapsed.add(nodeId);
    notify();
  },
  set(nodeId: string, collapsed: boolean) {
    if (collapsed === _collapsed.has(nodeId)) return;
    if (collapsed) _collapsed.add(nodeId);
    else _collapsed.delete(nodeId);
    notify();
  },
  clear() {
    if (_collapsed.size === 0) return;
    _collapsed.clear();
    notify();
  },
  subscribe,
};

registerNodeForget(collapseStore.forget);
registerNodeForgetAll(() => collapseStore.clear());
