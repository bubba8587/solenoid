// [[B3]] sameNodeEverywhere. Dev probes only (collapseSweep.ts): every mounted surface's React Flow store, so a probe
// can read the handle bounds cables are drawn from.
import type { useStoreApi } from "@xyflow/react";

type StoreApi = ReturnType<typeof useStoreApi>;
export const devRfStores = new Set<StoreApi>();

export function registerDevRfStore(store: StoreApi): () => void {
  devRfStores.add(store);
  return () => { devRfStores.delete(store); };
}
