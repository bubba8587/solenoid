// [[B10]] reactFlowView (module-singleton store, storeKit), [[C40]] storesRegisterForget

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const _flipped = new Set<string>();
const { notify, subscribe } = createNotifier();

export const socketFlipStore = {
  get: (nodeId: string) => _flipped.has(nodeId),
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
  clear() {
    if (_flipped.size === 0) return;
    _flipped.clear();
    notify();
  },
  subscribe,
};

registerNodeForget(socketFlipStore.forget);
registerNodeForgetAll(() => socketFlipStore.clear());
