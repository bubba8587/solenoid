// Which Expression node's formula popup is open. Must stay a module store: the
// opener sits in rete's separate React root and can't reach App through context.
import { createValueStore } from "./storeKit";

const core = createValueStore<string>();

export const formulaPopup = {
  ...core,
  open(nodeId: string) {
    if (core.get() === nodeId) return;
    core.open(nodeId);
  },
};
