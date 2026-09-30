// [[B10]] reactFlowView (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";

const core = createValueStore<string>();

export const formulaPopup = {
  ...core,
  open(nodeId: string) {
    if (core.get() === nodeId) return;
    core.open(nodeId);
  },
};
