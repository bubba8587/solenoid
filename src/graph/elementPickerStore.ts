// [[B10]] reactFlowView (module-singleton store, storeKit)
// The open element-picker popup, or null; opened from an Element node, mounted once in App.
import { createValueStore } from "./storeKit";

export interface ElementPickerState {
  /** The node's current element symbol (highlighted in the table). */
  symbol: string;
  /** Called with the picked symbol; the opener owns the node update + recompute. */
  onPick: (symbol: string) => void;
}

export const elementPicker = createValueStore<ElementPickerState>();
