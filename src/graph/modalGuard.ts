// [[C43]] oneFlowSurface (the surface installs the keyboard once)
// Does an overlay own the keyboard? Detected from the DOM (`aria-modal="true"` or an
// overlay root below) plus the store-backed surfaces that render no dialog role.
// The answer is pinned on the event at CAPTURE time: an overlay may close on the key it
// answers, so a bubble-time DOM check would see no modal on the same keystroke.
import { paletteStore } from "./paletteStore";
import { frStore } from "./frStore";
import { settingsPanel } from "./settingsStore";
import { shortcutsStore } from "./shortcutsStore";

export const MODAL_SELECTOR =
  '[aria-modal="true"], .sol-popup-overlay, .solenoid-confirm__overlay, .conn-dialog__overlay';

type Doc = Pick<Document, "querySelector"> | null;
const liveDoc = (): Doc => (typeof document === "undefined" ? null : document);

export function modalOwnsKeyboard(doc: Doc = liveDoc()): boolean {
  if (paletteStore.get() || frStore.get() || settingsPanel.get() || shortcutsStore.get()) return true;
  return !!doc?.querySelector(MODAL_SELECTOR);
}

const underModal = new WeakSet<object>();

/** Capture-phase: remember that this key arrived while an overlay owned the keyboard. */
export function markIfUnderModal(e: object, doc: Doc = liveDoc()): void {
  if (modalOwnsKeyboard(doc)) underModal.add(e);
}

/** Bubble-phase: did an overlay own this key when it arrived (or does one now)? */
export function keyUnderModal(e: object, doc: Doc = liveDoc()): boolean {
  return underModal.has(e) || modalOwnsKeyboard(doc);
}

// Registered at load, so it runs before any overlay's own capture handler (same target,
// registration order) and sees the overlay still open.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => markIfUnderModal(e), true);
}
