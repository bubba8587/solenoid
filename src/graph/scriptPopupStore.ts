// Which Script node's editor popup is open. A module store for the same reason as
// formulaPopupStore: the opener sits in the canvas React tree, the popup in App's.
import { createValueStore } from "./storeKit";

const core = createValueStore<string>();

export const scriptPopup = {
  ...core,
  open(nodeId: string) {
    if (core.get() === nodeId) return;
    core.open(nodeId);
  },
};
