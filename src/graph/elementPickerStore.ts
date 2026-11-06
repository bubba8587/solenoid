// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";

interface ElementPickerState {
  symbol: string;
  onPick: (symbol: string) => void;
}

export const elementPicker = createValueStore<ElementPickerState>();
