// Which Expression node's formula popup is open (its node id), or null.
// Module store (not React context): the expand button lives inside a node, which
// Rete renders in a separate React root, so it can't reach an app-level overlay
// through context. The popup is mounted once in App and reads this store. Mirrors
// connectionDialogStore / frStore.
import { createValueStore } from "./storeKit";

const core = createValueStore<string>();

export const formulaPopup = {
  ...core,
  open(nodeId: string) {
    if (core.get() === nodeId) return;
    core.open(nodeId);
  },
};
