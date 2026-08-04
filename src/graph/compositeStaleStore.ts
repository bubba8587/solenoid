// A held composite's OUTPUT doesn't change when it goes stale, so processGraph's
// changed-output re-render pruning would skip the card — the card subscribes here
// instead, and the dot appears the moment data() flags it.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const stale = new Set<string>();
const { notify, subscribe, version } = createNotifier();

export const compositeStaleStore = {
  /** Called from CompositeNode.data() each pass with the node's current staleness. */
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
