// Which composites are STALE — a heavy run mode (goal-seek / scenarios / data-table /
// simulation) whose inputs or config changed since its last Solve, so its held result
// is out of date. A module-level store (not React context) because the composite card
// renders in rete's separate React root, and because a held composite's OUTPUT doesn't
// change — so processGraph's changed-output re-render pruning would skip the card. The
// card subscribes here so the stale dot appears the moment data() flags it.

import { createNotifier } from "./storeKit";

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
