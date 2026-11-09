// [[B2]] webTryDesktopFull: Android's back gesture (docs/android.md) closes the topmost popup, menu or panel first, as
// Escape does, and leaves the app only from the bare canvas.
import { isAndroidApp } from "./fileBridge";
import { escapeClosersOpen } from "./components/useEscapeToClose";
import { openLayerCount } from "./components/escapeLayers";

/** Anything Escape would close: a surface on the shared Escape hook, a menu on a popup, or a dialog or menu that
 *  handles its own Escape (found by its role). */
export function somethingToClose(doc: Pick<Document, "querySelector"> = document): boolean {
  return escapeClosersOpen() > 0 || openLayerCount() > 0
    || doc.querySelector('[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

/** Escape, sent where a key press would go: the focused element, bubbling to the document and window. */
function pressEscape(): void {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
}

export async function initAndroidBack(): Promise<void> {
  if (!isAndroidApp()) return;
  const { onBackButtonPress, exit } = await import("@tauri-apps/api/app");
  const { flushSaveNow } = await import("./persistence");
  await onBackButtonPress(() => {
    if (somethingToClose()) { pressEscape(); return; }
    flushSaveNow();
    void exit(0);
  });
}
