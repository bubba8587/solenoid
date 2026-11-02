// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { useSyncExternalStore } from "react";
import { createSavedToggle } from "./storeKit";

export const DOT_SPACING = 24;

export const gridSnapStore = createSavedToggle("solenoid.gridSnap");

export function initGridSnap() {
  gridSnapStore.load();
}

export function useGridSnap(): { snap: boolean; toggleSnap: () => void } {
  const snap = useSyncExternalStore(gridSnapStore.subscribe, gridSnapStore.get);
  return { snap, toggleSnap: () => gridSnapStore.toggle() };
}
