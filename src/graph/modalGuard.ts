// [[C43]] oneFlowSurface (the surface installs the keyboard once)
// Does an overlay own the keyboard? Pinned on the event at capture time, since an overlay may close on the key it
// answers and a bubble-time check would then see no modal.
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

export function markIfUnderModal(e: object, doc: Doc = liveDoc()): void {
  if (modalOwnsKeyboard(doc)) underModal.add(e);
}

export function keyUnderModal(e: object, doc: Doc = liveDoc()): boolean {
  return underModal.has(e) || modalOwnsKeyboard(doc);
}

// Registered at load, so it runs before any overlay's own capture handler and sees the overlay still open.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => markIfUnderModal(e), true);
}
