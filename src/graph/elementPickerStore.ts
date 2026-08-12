// A module store like tablePopup: opened from inside an Element node (a separate React
// root), mounted once in App.
import { createValueStore } from "./storeKit";

export interface ElementPickerState {
  /** The node's current element symbol (highlighted in the table). */
  symbol: string;
  /** Called with the picked symbol; the opener owns the node update + recompute. */
  onPick: (symbol: string) => void;
}

export const elementPicker = createValueStore<ElementPickerState>();
