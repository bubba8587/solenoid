// The currently-open Element picker (search field + clickable periodic table),
// or null. Module store like tablePopup / chartPopup: opened from inside an
// Element node (a separate React root), mounted once in App.
import { createNotifier } from "./storeKit";

export interface ElementPickerState {
  /** The node's current element symbol (highlighted in the table). */
  symbol: string;
  /** Called with the picked symbol; the opener owns the node update + recompute. */
  onPick: (symbol: string) => void;
}

let _state: ElementPickerState | null = null;
const notifier = createNotifier();

export const elementPicker = {
  get: (): ElementPickerState | null => _state,
  open(state: ElementPickerState): void {
    _state = state;
    notifier.notify();
  },
  close(): void {
    if (!_state) return;
    _state = null;
    notifier.notify();
  },
  subscribe: notifier.subscribe,
};
