// [[B10]] reactFlowView (module-singleton store, storeKit), [[D52]] compositesHoldUntilSolve

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const stale = new Set<string>();
const { notify, subscribe, version } = createNotifier();

export const compositeStaleStore = {
  set(id: string, isStale: boolean): void {
    const had = stale.has(id);
    if (isStale === had) return;
    if (isStale) stale.add(id); else stale.delete(id);
    notify();
  },
  isStale(id: string): boolean {
    return stale.has(id);
  },
  subscribe,
  getVersion: version,
};

registerNodeForget((id) => compositeStaleStore.set(id, false));
registerNodeForgetAll(() => { if (stale.size > 0) { stale.clear(); notify(); } });
