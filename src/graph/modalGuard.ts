// One question every canvas-level key handler asks first: does an overlay own the
// keyboard? While a modal dialog or a pop-up is open, the canvas shortcuts (bare
// Enter → palette, A → Add menu, T → Tidy, Delete, …) stand down; the overlay's own
// handlers are the only ones live. Detected from the DOM — an overlay declares itself
// by rendering `aria-modal="true"` or one of the overlay roots below — plus the
// store-backed surfaces that render no dialog role.
import { paletteStore } from "./paletteStore";
import { frStore } from "./frStore";
import { settingsPanel } from "./settingsStore";
import { shortcutsStore } from "./shortcutsStore";

export const MODAL_SELECTOR =
  '[aria-modal="true"], .sol-popup-overlay, .solenoid-confirm__overlay, .conn-dialog__overlay';

export function modalOwnsKeyboard(doc: Pick<Document, "querySelector"> | null = typeof document === "undefined" ? null : document): boolean {
  if (paletteStore.get() || frStore.get() || settingsPanel.get() || shortcutsStore.get()) return true;
  return !!doc?.querySelector(MODAL_SELECTOR);
}
