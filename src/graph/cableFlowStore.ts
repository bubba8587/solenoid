// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { useSyncExternalStore } from "react";
import { createSavedToggle } from "./storeKit";

export const cableFlowStore = createSavedToggle("solenoid.cableFlow");

export function initCableFlow() {
  cableFlowStore.load();
}

export function useCableFlow(): { flow: boolean; toggleFlow: () => void } {
  const flow = useSyncExternalStore(cableFlowStore.subscribe, cableFlowStore.get);
  return { flow, toggleFlow: () => cableFlowStore.toggle() };
}
