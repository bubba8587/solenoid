// Per-node collapsed state. Module-level store (like cableState /
// dockedNodeStore) so it's readable from any React root — Rete renders
// node components in a separate root from the main app.
//
// Collapsed nodes hide their body controls (input rows, op selectors)
// but keep the result/display box and their socket dots.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const _collapsed = new Set<string>();
const { notify, subscribe } = createNotifier();

export const collapseStore = {
  get: (nodeId: string) => _collapsed.has(nodeId),
  /** Forget a deleted node (noderemoved → forgetNode). */
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
  /** Drop every entry — loadGraph calls this so stale ids from the previous
   *  graph can't leak into the new one. */
  clear() {
    if (_collapsed.size === 0) return;
    _collapsed.clear();
    notify();
  },
  subscribe,
};

registerNodeForget(collapseStore.forget);
registerNodeForgetAll(() => collapseStore.clear());
