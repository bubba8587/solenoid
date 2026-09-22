// [[B10]] reactFlowView (module-singleton store, storeKit), [[C40]] storesRegisterForget
// Per-node "sockets flipped" state; the flip mechanics (who reads it, what stays
// semantic) are in tree/specs/canvas/react-flow-surface-contract.md.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const _flipped = new Set<string>();
const { notify, subscribe } = createNotifier();

export const socketFlipStore = {
  get: (nodeId: string) => _flipped.has(nodeId),
  /** Forget a deleted node (noderemoved → forgetNode). */
  forget(nodeId: string) {
    if (_flipped.delete(nodeId)) notify();
  },
  toggle(nodeId: string) {
    if (_flipped.has(nodeId)) _flipped.delete(nodeId);
    else _flipped.add(nodeId);
    notify();
  },
  set(nodeId: string, flipped: boolean) {
    if (flipped === _flipped.has(nodeId)) return;
    if (flipped) _flipped.add(nodeId);
    else _flipped.delete(nodeId);
    notify();
  },
  /** Drop every entry — loadGraph's rebuild clears so stale ids can't leak. */
  clear() {
    if (_flipped.size === 0) return;
    _flipped.clear();
    notify();
  },
  subscribe,
};

registerNodeForget(socketFlipStore.forget);
registerNodeForgetAll(() => socketFlipStore.clear());
