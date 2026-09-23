// [[B10]] reactFlowView (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";

const core = createValueStore<string>();

export const scriptPopup = {
  ...core,
  open(nodeId: string) {
    if (core.get() === nodeId) return;
    core.open(nodeId);
  },
};
