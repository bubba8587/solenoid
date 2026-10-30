// [[A1]] visualGraphCalculator (module-singleton store, storeKit), [[C23]] calcModes

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const stale = new Set<string>();
const runMs = new Map<string, number>();
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
  /** How long a held composite's last solve took, so its card can show it. */
  ran(id: string, ms: number): void {
    runMs.set(id, ms);
    notify();
  },
  lastRunMs(id: string): number | null {
    return runMs.get(id) ?? null;
  },
  subscribe,
  getVersion: version,
};

registerNodeForget((id) => { runMs.delete(id); compositeStaleStore.set(id, false); });
registerNodeForgetAll(() => {
  runMs.clear();
  if (stale.size > 0) { stale.clear(); notify(); }
});
