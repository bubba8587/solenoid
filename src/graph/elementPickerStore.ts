// [[B10]] reactFlowView (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";

export interface ElementPickerState {
  symbol: string;
  onPick: (symbol: string) => void;
}

export const elementPicker = createValueStore<ElementPickerState>();
