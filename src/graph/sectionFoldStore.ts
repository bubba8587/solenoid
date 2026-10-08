// [[A1]] visualGraphCalculator (module-singleton store, storeKit), [[B12]] losslessSaves

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

// Per node, the CardSections the user has folded or opened by hand, keyed by section label; true is open.
const _folds = new Map<string, Record<string, boolean>>();
const { notify, subscribe } = createNotifier();

export const sectionFoldStore = {
  get: (nodeId: string, section: string): boolean | undefined => _folds.get(nodeId)?.[section],
  all: (nodeId: string): Record<string, boolean> | undefined => _folds.get(nodeId),
  set(nodeId: string, section: string, open: boolean) {
    const cur = _folds.get(nodeId);
    if (cur?.[section] === open) return;
    _folds.set(nodeId, { ...cur, [section]: open });
    notify();
  },
  setAll(nodeId: string, sections: Record<string, boolean>) {
    _folds.set(nodeId, { ...sections });
    notify();
  },
  forget(nodeId: string) {
    if (_folds.delete(nodeId)) notify();
  },
  clear() {
    if (_folds.size === 0) return;
    _folds.clear();
    notify();
  },
  subscribe,
};

registerNodeForget(sectionFoldStore.forget);
registerNodeForgetAll(() => sectionFoldStore.clear());
